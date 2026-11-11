"""Audit all published anchors, without treating a finite run as convergence."""
from pathlib import Path
import json, re, hashlib
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
ANCHORS = ['base', 'low', 'high', 'open', 'left', 'right', 'locked', 'fast', 'spin']
records = []
for car in ['rb19', 'rb16b']:
    manifest = json.loads((ROOT / f'web/public/flow/{car}/manifest.json').read_text())
    assert {a['anchor'] for a in manifest['anchors']} == set(ANCHORS)
    for anchor in ANCHORS:
        a = next(a for a in manifest['anchors'] if a['anchor'] == anchor)
        case = ROOT / f'cfd/library/cases/{car}-{anchor}'
        log = (case / 'log.foamRun').read_text()
        assert a['meshOk'] and a['lastIteration'] == 650
        assert not re.search(r'residual = [-+]?nan|FOAM FATAL', log, re.I)
        binary = (ROOT / ('web/public' + a['file'])).read_bytes()
        assert hashlib.sha256(binary).hexdigest() == a['sha256']
        values = np.frombuffer(binary, dtype='<i2').astype(float) * a['scale']
        assert np.isfinite(values).all() and np.max(np.abs(values)) > 0
        history = []
        for line in (case / 'postProcessing/forces/0/forces.dat').read_text().splitlines():
            if line.startswith('#') or not line.strip():
                continue
            numbers = np.array([float(v) for v in re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', line)])
            if numbers[0] >= 550:
                history.append(numbers[1:4] + numbers[4:7])
        force = np.array(history)
        assert len(force) >= 100 and np.isfinite(force).all()
        # Force history is a convergence diagnostic only, never advertised as
        # the real car's drag/downforce from this display proxy.
        relative_range = np.ptp(force, axis=0) / np.maximum(np.abs(force.mean(axis=0)), 1)
        continuity = re.findall(r'sum local = ([\deE+.-]+), global = ([\deE+.-]+)', log)
        last_local, last_global = map(float, continuity[-1])
        records.append({
            'car': car, 'anchor': anchor, 'cells': a['cells'],
            'residuals': a['residuals'], 'lastLocalContinuity': last_local,
            'lastGlobalContinuity': last_global,
            'forceRelativeRangeLast100': relative_range.tolist(),
            'excludedNumericalSamples': a.get('excludedNumericalSamples', 0),
            'rawFieldMax': a.get('rawFieldMax'), 'displayFieldMax': a['fieldMax'],
            'strictResidualTargetMet': max(a['residuals'].values()) < 1e-4,
        })
report = {'records': records, 'scope': 'Exploratory steady coarse RANS only; no grid independence, experimental validation, transient turbulence, or validated multi-factor surrogate.'}
(ROOT / 'cfd/library/reports/library-quality.json').write_text(json.dumps(report, indent=2) + '\n')
rows = ['# 双车流场库数值审阅', '', '18 个独立稳态算例；有限值、Mesh OK 与文件校验通过不代表工程收敛。严格残差目标仅用于披露，未据此包装性能结论。', '', '|车型|工况|网格单元|最大初始残差|末步局部连续性误差|排除异常采样|', '|---|---|---:|---:|---:|---:|']
for r in records:
    rows.append(f"|{r['car']}|{r['anchor']}|{r['cells']}|{max(r['residuals'].values()):.3g}|{r['lastLocalContinuity']:.3g}|{r['excludedNumericalSamples']}|")
rows += ['', '原始速度尖峰仍保留在本地算例；超过三倍入口／轮周最大速度的孤立采样置为无效零值，使流线终止，而非截断成一个好看的速度。异常占比达到 0.2% 时整例拒绝。原始最大值、排除数量与阈值均在公开 manifest 中。', '', '逐例末 100 步力波动、残差与守恒记录见同目录 `library-quality.json`。未作网格、计算域、时间步独立性或风洞实验验证；不得用于真实赛车阻力、下压力或设计决策。']
(ROOT / 'cfd/library/reports/library-quality.md').write_text('\n'.join(rows) + '\n')
print('Audited 18 finite solved fields, original logs, meshes, hashes and force histories')
