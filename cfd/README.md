# AERO CFD

本目录保存本机 CFD 安装、简单算例和 RB19 全车粗网格计算的可复现脚本。二进制网格、全场数据和虚拟环境由 `.gitignore` 排除；`reports/` 保存可审阅的摘要。模型展示源码和 Blender 工作文件不被计算预处理覆盖。

下文保留早期 RB19 单基线流程。当前双车 18 工况与网页插值的复算、结果质量和限制见 [流场库说明](library/README.md)，完成情况见 [交付记录](../docs/design/interactive-airflow-delivery-2026-11-10.md)。

## 环境

- 主机 Apple Silicon、16 GiB 内存；已有 OrbStack。
- 专用 Ubuntu 24.04 ARM64 机器：`aero-cfd`。
- OpenFOAM Foundation 14，官方 Ubuntu 软件包；运行环境按需 `source /opt/openfoam14/etc/bashrc`，未修改用户全局 shell 配置。
- 官方参考：[Ubuntu 安装](https://openfoam.org/download/14-ubuntu/)、[Apple Silicon 支持](https://openfoam.org/download/14-macos/)、[OrbStack Linux 机器](https://docs.orbstack.dev/machines/)。
- 主机后处理 Python 环境为 `cfd/.venv`。依赖锁定在 `python-requirements.txt`；Apple 自带 Python 3.9 的 fast-simplification 注解兼容补丁仅应用于此 venv，见 `scripts/bootstrap-python.sh`。

## 已运行的小算例

官方 `incompressibleFluid/pitzDailySteady`。在 `cases/pitzDailySteady` 保留 blockMesh、checkMesh、foamRun 的原始日志与流线结果。它验证软件环境、网格与数值流程，不等于汽车气动或风洞实验验证。

## 全车试算定义

第一辆车选择 RB19，50 m/s（180 km/h），中立转向，DRS 关闭。CFD 坐标为 X 向车后、Y 向车右、Z 向上，相对于网页坐标变换为 `(-Z,-X,Y)`。

原 GLB 的车身存在开放／非流形边，后轮有开放轮毂边界。`prepare_geometry.py` 输出审计、分组表面和源 GLB 摘要。`close_geometry.py` 只生成独立计算副本：以三角扇封闭后轮内部轮毂小孔，再做 10 mm 表面体素化、一个体素的形态闭运算、内部空洞填充及等值面重建。网格简化只有在仍封闭时才保留，否则退回封闭版本。

这会改变薄翼、狭缝、杆件、内部通道和表面细节，不能替代工程 CAD 清理。计算副本整体下移 5 mm；体素取样使轮地接触成为有限相交的近似，不代表受载轮胎变形。具体网格与几何见 `reports/`。

- 空气运动黏度 1.5e-5 m²/s，力积分密度 1.225 kg/m³。
- 入口 `(50 0 0)` m/s，出口参考运动学压力 0；侧面、顶部为远场对称边界，不是有实体壁面的风洞。
- 地面速度 `(50 0 0)`；四轮使用各自轮心、轴线和半径的 rotatingWallVelocity，角速度 `50/r`。
- k-omega SST 稳态 RANS，1% 入口湍流强度、约 0.05 m 湍流长度尺度（k=.375、omega≈22.36）。
- 粗网格、无棱柱边界层，采用壁面函数和一阶迎风。必须审阅 y+；本轮不具备网格／计算域无关性。
- 计算域 `[-20,38]×[-12,12]×[0,16]` m。质量检查包含全部网格和单连通流体区域；不会跳过已失败的检查。

## 脚本

- `scripts/install-openfoam.sh`：只在专用 Ubuntu 内执行的官方包安装流程。
- `scripts/bootstrap-python.sh`：项目隔离的主机后处理环境。
- `scripts/prepare_geometry.py`、`close_geometry.py`、`create_car_case.py`：审计、封闭副本与工况。已有已划分网格的同名算例会拒绝被配置生成器覆盖。
- `scripts/mesh-car.sh`：blockMesh、surfaceCheck、snappyHexMesh 和 checkMesh。创建和计算目录仅限 `cases/rb19-50ms-coarse`。
- `scripts/solve-car.sh`：通过 Mesh OK 后四进程求解，最多利用 4 个 CPU；不启动 Blender。
- `scripts/export-results.sh`：最后迭代的速度／压力切片、流线和车辆表面数据。
- `scripts/summarize_run.py`：生成收敛、守恒和力历史摘要；保留局限，不自动给出“工程验收通过”。

现有脚本按本机项目路径运行；不能不经检查就对其他机器的现有 CFD 文件执行。`cases/` 内结果尚未备份到远端。
