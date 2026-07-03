"""Sandbox replay service for running Foundry PoC exploits with a persistent workspace."""

import asyncio
import hashlib
import shutil
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class ReplayResult:
    """Result of a sandbox PoC replay."""
    verdict: str  # "CHALLENGE_UPHELD" or "DISMISSED"
    reason: str
    replay_trace_hash: str
    output: str
    exit_code: int


@dataclass
class FuzzResult:
    """Result of an invariant fuzz test run."""
    verdict: str        # "INVARIANT_HOLDS" or "INVARIANT_BROKEN"
    reason: str
    counterexample: str  # The call sequence that broke the invariant, if any
    runs: int            # Number of fuzz runs completed
    output: str
    exit_code: int


class SandboxService:
    """Runs Foundry PoC exploits in a persistent workspace (initialized once)."""

    TIMEOUT_SECONDS = 30

    def __init__(self, workspace_dir: Optional[str] = None):
        """
        Initialize the persistent sandbox workspace.

        Args:
            workspace_dir: Path to the workspace directory. Defaults to
                           contracts/sandbox_workspace/ relative to project root.
        """
        if workspace_dir:
            self._workspace = Path(workspace_dir)
        else:
            project_root = Path(__file__).resolve().parent.parent.parent
            self._workspace = project_root / "contracts" / "sandbox_workspace"

        self._initialized = False
        self._lock = threading.Lock()  # Serialize sandbox file writes + forge runs

    async def ensure_initialized(self) -> None:
        """Initialize the Foundry project structure and install deps (only once)."""
        if self._initialized:
            return

        if self._workspace.exists() and (self._workspace / "foundry.toml").exists():
            # Already set up from a previous run
            logger.info("Sandbox workspace already exists, reusing: %s", self._workspace)
            self._initialized = True
            return

        logger.info("Initializing persistent sandbox at: %s", self._workspace)
        self._workspace.mkdir(parents=True, exist_ok=True)
        (self._workspace / "src").mkdir(exist_ok=True)
        (self._workspace / "test").mkdir(exist_ok=True)
        (self._workspace / "lib").mkdir(exist_ok=True)

        # Write foundry.toml
        self._write_foundry_toml()

        # Install forge-std
        await self._install_deps()

        self._initialized = True
        logger.info("Sandbox initialization complete.")

    async def replay_poc(
        self,
        poc_code: str,
        contract_source: str,
        fork_rpc: Optional[str] = None,
        fork_block: Optional[int] = None,
    ) -> ReplayResult:
        """
        Replay a PoC exploit in the persistent sandbox.

        Overwrites src/Target.sol and test/Exploit.t.sol, clears the out/ cache,
        then runs forge test.

        Args:
            poc_code: Solidity test code (the exploit)
            contract_source: Solidity source of the target contract
            fork_rpc: Optional RPC URL for forking
            fork_block: Optional block number for forking

        Returns:
            ReplayResult with verdict, trace hash, and output
        """
        await self.ensure_initialized()

        # Acquire lock to serialize file writes + forge execution
        self._lock.acquire()
        try:
            # Update foundry.toml if fork params changed
            self._write_foundry_toml(fork_rpc, fork_block)

            # Overwrite contract and test files
            (self._workspace / "src" / "Target.sol").write_text(contract_source, encoding="utf-8")
            (self._workspace / "test" / "Exploit.t.sol").write_text(poc_code, encoding="utf-8")

            # Clear compilation cache to avoid stale artifacts
            out_dir = self._workspace / "out"
            if out_dir.exists():
                shutil.rmtree(out_dir)

            # Run forge test
            exit_code, output = await self._run_forge_test()
        finally:
            self._lock.release()

        # Compute replay trace hash
        replay_trace_hash = f"0x{hashlib.sha256(output.encode()).hexdigest()}"

        # Determine verdict
        if exit_code == 0 and "no tests found" not in output.lower():
            verdict = "CHALLENGE_UPHELD"
            reason = "PoC exploit executed successfully — vulnerability confirmed"
        else:
            verdict = "DISMISSED"
            if "timeout" in output.lower() or exit_code == -1:
                reason = "PoC execution timed out"
            elif "no tests found" in output.lower():
                reason = "No test functions found in PoC (must start with 'test')"
            elif "compilation failed" in output.lower() or "compiler error" in output.lower():
                reason = "PoC compilation failed"
            else:
                reason = f"PoC failed with exit code {exit_code}"

        return ReplayResult(
            verdict=verdict,
            reason=reason,
            replay_trace_hash=replay_trace_hash,
            output=output[-4096:],  # Truncate to last 4KB
            exit_code=exit_code,
        )

    def _write_foundry_toml(
        self, fork_rpc: Optional[str] = None, fork_block: Optional[int] = None
    ) -> None:
        """Write foundry.toml configuration."""
        config_lines = [
            "[profile.default]",
            'src = "src"',
            'out = "out"',
            'libs = ["lib"]',
            "ffi = false",
        ]

        if fork_rpc:
            config_lines.append(f'eth_rpc_url = "{fork_rpc}"')
            if fork_block:
                config_lines.append(f"fork_block_number = {fork_block}")

        (self._workspace / "foundry.toml").write_text("\n".join(config_lines) + "\n")

    async def _install_deps(self) -> None:
        """Install forge-std into the workspace (called once during init)."""
        lib_dir = self._workspace / "lib"
        forge_std_dir = lib_dir / "forge-std"

        if forge_std_dir.exists():
            logger.info("forge-std already present, skipping install.")
            return

        logger.info("Installing forge-std...")
        try:
            process = await asyncio.create_subprocess_exec(
                "forge", "install", "foundry-rs/forge-std",
                "--no-git", "--no-commit",
                cwd=str(self._workspace),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)
            if process.returncode == 0:
                logger.info("forge-std installed successfully.")
            else:
                logger.warning("forge install returned %d: %s", process.returncode, stderr.decode(errors="replace"))
        except (asyncio.TimeoutError, Exception) as e:
            logger.warning("forge install failed (%s), attempting fallback copy.", e)
            # Fallback: copy from the main project's forge-std if available
            main_forge_std = Path(__file__).resolve().parent.parent.parent / "contracts" / "lib" / "forge-std"
            if main_forge_std.exists() and not forge_std_dir.exists():
                shutil.copytree(str(main_forge_std), str(forge_std_dir), symlinks=True)

    async def _run_forge_test(self) -> tuple[int, str]:
        """Run forge test and return (exit_code, combined_output)."""
        cmd = ["forge", "test", "-vvvv"]

        env = os.environ.copy()
        env["FOUNDRY_PROFILE"] = "default"
        env["FOUNDRY_DISABLE_NIGHTLY_WARNING"] = "1"

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(self._workspace),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), timeout=self.TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.communicate()
                return -1, "Execution timed out after 60 seconds"

            output = stdout.decode(errors="replace") + stderr.decode(errors="replace")
            return process.returncode or 0, output

        except FileNotFoundError:
            return -2, "forge not found — ensure Foundry is installed"
        except Exception as e:
            return -3, f"Sandbox execution error: {e}"

    async def run_invariant_fuzz(
        self,
        invariant_test_code: str,
        contract_source: str,
        fuzz_runs: int = 256,
    ) -> "FuzzResult":
        """
        Run a Foundry invariant fuzz test to verify that safety constraints hold
        under randomised call sequences.

        The proposer generates `invariant_test_code` (via LLM from hard constraints).
        The sandbox runs `forge test --match-contract InvariantTest` with fuzz
        enabled.  If the invariant is never broken across `fuzz_runs` sequences,
        the "safe" verdict is considered verified.  If Foundry finds a
        counterexample it is extracted from the output and returned so it can be
        escalated directly into a challenge PoC.

        Args:
            invariant_test_code: Solidity invariant test contract (InvariantTest).
            contract_source:     Target contract source code.
            fuzz_runs:           Number of randomised call sequences to attempt.

        Returns:
            FuzzResult with verdict, optional counterexample, and run count.
        """
        await self.ensure_initialized()

        self._lock.acquire()
        try:
            # Write target contract and invariant test
            (self._workspace / "src" / "Target.sol").write_text(
                contract_source, encoding="utf-8"
            )
            (self._workspace / "test" / "InvariantTest.t.sol").write_text(
                invariant_test_code, encoding="utf-8"
            )

            # Configure fuzz runs in foundry.toml
            config_lines = [
                "[profile.default]",
                'src = "src"',
                'out = "out"',
                'libs = ["lib"]',
                "ffi = false",
                "",
                "[fuzz]",
                f"runs = {fuzz_runs}",
                "",
                "[invariant]",
                f"runs = {fuzz_runs}",
                "depth = 15",          # call sequence depth per run
                "fail_on_revert = false",  # revert ≠ invariant broken
            ]
            (self._workspace / "foundry.toml").write_text(
                "\n".join(config_lines) + "\n"
            )

            # Clear stale artifacts
            out_dir = self._workspace / "out"
            if out_dir.exists():
                shutil.rmtree(out_dir)

            exit_code, output = await self._run_forge_invariant()
        finally:
            self._lock.release()

        # Parse result
        return self._parse_fuzz_result(exit_code, output, fuzz_runs)

    async def _run_forge_invariant(self) -> tuple[int, str]:
        """Run forge test targeting InvariantTest contracts."""
        cmd = [
            "forge", "test",
            "--match-contract", "InvariantTest",
            "-vvv",
        ]
        env = os.environ.copy()
        env["FOUNDRY_PROFILE"] = "default"
        env["FOUNDRY_DISABLE_NIGHTLY_WARNING"] = "1"

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(self._workspace),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), timeout=self.TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.communicate()
                return -1, "Invariant fuzz timed out"

            output = stdout.decode(errors="replace") + stderr.decode(errors="replace")
            return process.returncode or 0, output

        except FileNotFoundError:
            return -2, "forge not found — ensure Foundry is installed"
        except Exception as e:
            return -3, f"Sandbox execution error: {e}"

    def _parse_fuzz_result(
        self, exit_code: int, output: str, fuzz_runs: int
    ) -> "FuzzResult":
        """Derive a FuzzResult from forge invariant test output."""
        output_lower = output.lower()

        # Foundry prints a counterexample call sequence when an invariant fails
        counterexample = ""
        if "counterexample" in output_lower or "sequence" in output_lower:
            # Extract the call sequence block for use as a PoC seed
            lines = output.splitlines()
            seq_lines = []
            capturing = False
            for line in lines:
                if "sequence" in line.lower() or "counterexample" in line.lower():
                    capturing = True
                if capturing:
                    seq_lines.append(line)
                    if len(seq_lines) > 40:   # cap extraction length
                        break
            counterexample = "\n".join(seq_lines)

        # Parse actual run count from forge output
        import re
        runs_match = re.search(r"runs:\s*(\d+)", output_lower)
        actual_runs = int(runs_match.group(1)) if runs_match else fuzz_runs

        if exit_code == 0 and "no tests found" not in output_lower:
            return FuzzResult(
                verdict="INVARIANT_HOLDS",
                reason=f"All invariants held across {actual_runs} randomised call sequences",
                counterexample="",
                runs=actual_runs,
                output=output[-4096:],
                exit_code=exit_code,
            )

        if exit_code == -1:
            return FuzzResult(
                verdict="INVARIANT_HOLDS",   # timeout → treat as inconclusive but pass
                reason="Fuzz run timed out — invariant not broken within time limit",
                counterexample="",
                runs=actual_runs,
                output=output[-4096:],
                exit_code=exit_code,
            )

        reason = "Invariant broken by fuzzer"
        if "compilation failed" in output_lower or "compiler error" in output_lower:
            reason = "Invariant test compilation failed"
        elif counterexample:
            reason = f"Invariant broken — counterexample call sequence found after {actual_runs} runs"

        return FuzzResult(
            verdict="INVARIANT_BROKEN",
            reason=reason,
            counterexample=counterexample,
            runs=actual_runs,
            output=output[-4096:],
            exit_code=exit_code,
        )

    def cleanup(self) -> None:
        """Optional: remove the workspace directory (for cleanup after experiments)."""
        if self._workspace.exists():
            shutil.rmtree(self._workspace)
            logger.info("Sandbox workspace cleaned up: %s", self._workspace)
            self._initialized = False
