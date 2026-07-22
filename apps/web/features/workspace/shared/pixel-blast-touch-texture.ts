import { LinearFilter, Texture } from 'three';

type TouchPoint = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  force: number;
  age: number;
};

/** 维护液态位移纹理；没有活动轨迹时停止 canvas 重绘和 GPU 上传。 */
export function createPixelBlastTouchTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PixelBlast: 2D context unavailable');

  const texture = new Texture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;

  const trail: TouchPoint[] = [];
  const maxAge = 64;
  const trailSpeed = 1 / maxAge;
  let last: { x: number; y: number } | null = null;
  let radius = 0.1 * size;
  let textureContainsTrail = false;
  let disposed = false;

  const clear = () => {
    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);
  };
  clear();
  texture.needsUpdate = true;

  const drawPoint = (point: TouchPoint) => {
    const x = point.x * size;
    const y = (1 - point.y) * size;
    const easeOutSine = (value: number) => Math.sin((value * Math.PI) / 2);
    const easeOutQuad = (value: number) => -value * (value - 2);
    let intensity =
      point.age < maxAge * 0.3
        ? easeOutSine(point.age / (maxAge * 0.3))
        : easeOutQuad(1 - (point.age - maxAge * 0.3) / (maxAge * 0.7)) || 0;
    intensity *= point.force;

    const color = `${((point.vx + 1) / 2) * 255}, ${((point.vy + 1) / 2) * 255}, ${intensity * 255}`;
    const offset = size * 5;
    context.shadowOffsetX = offset;
    context.shadowOffsetY = offset;
    context.shadowBlur = radius;
    context.shadowColor = `rgba(${color},${0.22 * intensity})`;
    context.beginPath();
    context.fillStyle = 'rgba(255,0,0,1)';
    context.arc(x - offset, y - offset, radius, 0, Math.PI * 2);
    context.fill();
  };

  return {
    texture,
    addTouch(position: { x: number; y: number }) {
      if (disposed) return;
      let force = 0;
      let vx = 0;
      let vy = 0;
      if (last) {
        const dx = position.x - last.x;
        const dy = position.y - last.y;
        if (dx === 0 && dy === 0) return;
        const squaredDistance = dx * dx + dy * dy;
        const distance = Math.sqrt(squaredDistance);
        vx = dx / (distance || 1);
        vy = dy / (distance || 1);
        force = Math.min(squaredDistance * 10000, 1);
      }
      last = position;
      trail.push({ ...position, age: 0, force, vx, vy });
    },
    resetPointer() {
      last = null;
    },
    update() {
      if (disposed) return;
      if (trail.length === 0) {
        if (textureContainsTrail) {
          clear();
          texture.needsUpdate = true;
          textureContainsTrail = false;
        }
        return;
      }

      clear();
      for (let index = trail.length - 1; index >= 0; index--) {
        const point = trail[index];
        if (!point) continue;
        const force = point.force * trailSpeed * (1 - point.age / maxAge);
        point.x += point.vx * force;
        point.y += point.vy * force;
        point.age++;
        if (point.age > maxAge) trail.splice(index, 1);
      }
      for (const point of trail) drawPoint(point);
      texture.needsUpdate = true;
      textureContainsTrail = trail.length > 0;
    },
    set radiusScale(value: number) {
      radius = 0.1 * size * value;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      trail.length = 0;
      last = null;
      texture.dispose();
    },
  };
}
