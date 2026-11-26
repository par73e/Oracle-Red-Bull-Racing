function drawTelemetryStamp(ctx, width, height, state, forces) {
  const carTitle = state.model === 'rb19' ? 'ORACLE RED BULL · RB19 (2023)' : 'RED BULL RACING · RB16B (2021)';
  const yaw = state.windAngle ? `${state.windAngle > 0 ? '+' : ''}${state.windAngle}°` : '0°';
  const drs = state.drs ? 'DRS OPEN' : 'DRS CLOSED';
  const df = forces?.downforceN != null ? `Fz ${Math.round(forces.downforceN)} N` : 'Fz —';
  const drag = forces?.dragN != null ? `D ${Math.round(forces.dragN)} N` : 'D —';
  const line = `${carTitle}   |   ${state.groundSpeed} KM/H · YAW ${yaw} · ${drs}   |   ${df} · ${drag}`;

  const padX = 36, padY = 28, barH = 54;
  ctx.save();
  ctx.font = '600 22px "AERO Sans", "Helvetica Neue", Arial, sans-serif';
  const textW = ctx.measureText(line).width;
  const boxW = Math.min(width - padX * 2, textW + 52);
  const x = padX, y = height - padY - barH;

  ctx.fillStyle = 'rgba(11, 14, 19, 0.78)';
  ctx.strokeStyle = 'rgba(224, 43, 40, 0.78)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, barH, 10);
  ctx.fill();
  ctx.stroke();

  // Red Bull accent bar on left edge
  ctx.fillStyle = '#e02b28';
  ctx.fillRect(x + 12, y + 13, 4, barH - 26);

  ctx.fillStyle = '#edf1f6';
  ctx.textBaseline = 'middle';
  ctx.fillText(line, x + 28, y + barH / 2 + 1);
  ctx.restore();
}

export async function capturePhoto2K({
  renderer, scene, camera, worlds, state, forces,
  withWatermark = true, underCar = false, onRestore,
}) {
  const targetW = 2560, targetH = 1440;
  const prevAspect = camera.aspect;
  const prevPixelRatio = renderer.getPixelRatio();
  let blob = null;
  try {
    camera.aspect = targetW / targetH;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(1);
    renderer.setSize(targetW, targetH, false);
    worlds.resize(targetW, targetH);
    worlds.render(camera, scene, !underCar);
    renderer.render(scene, camera);

    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    ctx.drawImage(renderer.domElement, 0, 0, targetW, targetH);
    if (withWatermark) drawTelemetryStamp(ctx, targetW, targetH, state, forces);
    blob = await new Promise(resolve => out.toBlob(resolve, 'image/png'));
  } finally {
    camera.aspect = prevAspect;
    renderer.setPixelRatio(prevPixelRatio);
    onRestore?.();
  }
  if (!blob) return null;
  const filename = `redbull-${state.model}-${state.groundSpeed}kmh-2k.png`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { width: targetW, height: targetH, bytes: blob.size, filename };
}
