# Polaris 研究报告 LaTeX 版本

将 `Polaris- (1).docx` 转写为 LaTeX，仿《计算机学报》(Chinese Journal of Computers) 排版风格（双栏、中文摘要/关键词、章节编号）。

## 编译方式

文档使用 `ctex` 宏集支持中文，**必须使用 XeLaTeX**（不能用 pdfLaTeX）。需运行两次以生成目录与交叉引用：

```bash
xelatex polaris.tex
xelatex polaris.tex
```

或使用 latexmk：

```bash
latexmk -xelatex polaris.tex
```

## 依赖

- TeX Live 2020+ 或 MiKTeX（自带 ctex、algorithm2e、listings、booktabs、tabularx 等）
- 当前机器未检测到 LaTeX 引擎，需先安装 TeX 发行版（如 `brew install --cask mactex` 或 `brew install texlive`）

## 说明

- 正文 6 章结构与原 Word 文档完全一致：研究问题、问题挑战、解决方案、实验验证、相关工作、批判性思考。
- 表格（TID 字段布局、实验环境、核心指标对比）使用 `booktabs` + `tabularx` 排版。
- `try_reserve` 预留协议用 `algorithm2e` 排版；提交验证算法保留原文 Python 伪代码，用 `listings` 排版。
- 优先级分配公式使用 `cases` 环境。
- 参考文献按学报风格手工编排于 `thebibliography`。
