import * as T from 'three';

// One road formation for pavement, shoulders and terrain. The measured centreline
// and elevation remain unchanged; only the adjoining earthworks are blended.
export function createSpaSurface(survey) {
  const road = survey.road;
  const curve = new T.CatmullRomCurve3(road.map(p => new T.Vector3(...p.slice(0, 3))), false, 'centripetal');
  curve.arcLengthDivisions = 1600;
  const { xs, zs, heights } = survey.terrain;
  function measuredHeight(x, z) {
    const gx = T.MathUtils.clamp((x-xs[0])/(xs.at(-1)-xs[0])*(xs.length-1), 0, xs.length-1.00001);
    const gz = T.MathUtils.clamp((z-zs[0])/(zs.at(-1)-zs[0])*(zs.length-1), 0, zs.length-1.00001);
    const i=Math.floor(gx), j=Math.floor(gz), u=gx-i, v=gz-j;
    return (heights[j*xs.length+i]*(1-u)+heights[j*xs.length+i+1]*u)*(1-v)
      +(heights[(j+1)*xs.length+i]*(1-u)+heights[(j+1)*xs.length+i+1]*u)*v;
  }
  function sample(t) {
    const p=curve.getPoint(t), v=curve.getTangent(t).normalize();
    const left=new T.Vector3(v.z,0,-v.x).normalize();
    const a=t*(road.length-1), i=Math.min(road.length-2,Math.floor(a)), f=a-i;
    return {p,v,left,t,rightWidth:T.MathUtils.lerp(road[i][3],road[i+1][3],f),leftWidth:T.MathUtils.lerp(road[i][4],road[i+1][4],f)};
  }
  function heightAt(s, offset) {
    const edge=offset>0?s.leftWidth:s.rightWidth;
    const distance=Math.max(0,Math.abs(offset)-edge);
    const window=(a,b,c,d)=>T.MathUtils.smoothstep(s.t,a,b)*(1-T.MathUtils.smoothstep(s.t,c,d));
    const formation=offset>0?1.2+19*window(.25,.27,.69,.71):1.2+12.8*window(.1,.12,.74,.76);
    const earthwork=s.p.y-distance*.02;
    const blend=T.MathUtils.smoothstep(distance,formation,formation+18);
    if(blend===0)return earthwork;
    const x=s.p.x+s.left.x*offset, z=s.p.z+s.left.z*offset;
    return T.MathUtils.lerp(earthwork,measuredHeight(x,z),blend);
  }
  function point(s, offset, lift=0) {
    const p=s.p.clone().addScaledVector(s.left,offset);
    p.y=heightAt(s,offset)+lift;
    return p;
  }
  function groundHeight(x,z) {
    let best=Infinity, t=0;
    for(let i=0;i<road.length-1;i++) {
      const a=road[i], b=road[i+1], dx=b[0]-a[0], dz=b[2]-a[2];
      const f=T.MathUtils.clamp(((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz),0,1);
      const ex=x-a[0]-dx*f, ez=z-a[2]-dz*f, d=ex*ex+ez*ez;
      if(d<best){best=d;t=(i+f)/(road.length-1);}
    }
    if(best>65*65)return measuredHeight(x,z)-.06;
    // Refine the planar projection onto the curved centreline. Projecting only
    // onto its 5m source chords shifts the height on the outside of a bend.
    for(let iteration=0;iteration<3;iteration++) {
      const delta=.0001, lo=Math.max(0,t-delta), hi=Math.min(1,t+delta);
      if(lo===t||hi===t)break;
      const p=curve.getPoint(t),a=curve.getPoint(lo),b=curve.getPoint(hi);
      const dx=(b.x-a.x)/(hi-lo),dz=(b.z-a.z)/(hi-lo);
      const ddx=(a.x-2*p.x+b.x)/(delta*delta),ddz=(a.z-2*p.z+b.z)/(delta*delta);
      const denominator=dx*dx+dz*dz+(p.x-x)*ddx+(p.z-z)*ddz;
      if(Math.abs(denominator)<1e-8)break;
      const next=T.MathUtils.clamp(t-((p.x-x)*dx+(p.z-z)*dz)/denominator,0,1);
      if(Math.abs(next-t)<1e-8){t=next;break;}t=next;
    }
    const s=sample(t), offset=(x-s.p.x)*s.left.x+(z-s.p.z)*s.left.z;
    // No extension of the road formation beyond the ends of the modelled road.
    if((t===0||t===1)&&best-offset*offset>4)return measuredHeight(x,z)-.06;
    return heightAt(s,offset)-.06;
  }
  function terrainGeometry(spacing=2.5) {
    const nx=Math.ceil((xs.at(-1)-xs[0])/spacing), nz=Math.ceil((zs.at(-1)-zs[0])/spacing);
    const positions=[],uv=[],colors=[],indices=[],color=new T.Color();
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++) {
      const x=T.MathUtils.lerp(xs[0],xs.at(-1),i/nx),z=T.MathUtils.lerp(zs[0],zs.at(-1),j/nz);
      positions.push(x,groundHeight(x,z),z);uv.push(x/3,z/3);
      color.set('#9fb886').multiplyScalar(1+.025*Math.sin(z*.07+x*.03));colors.push(...color.toArray());
      if(i<nx&&j<nz){const k=j*(nx+1)+i;indices.push(k,k+nx+1,k+1,k+1,k+nx+1,k+nx+2);}
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    g.setIndex(indices);g.computeVertexNormals();return g;
  }
  function ribbonGeometry(from,to,{segments=680,lift=0,start=0,end=1,uvScale=3,curb=false}={}) {
    const positions=[],uv=[],colors=[],indices=[];
    // Lateral subdivisions let broad paved areas follow the same cross-section
    // as the terrain, instead of stretching one flat triangle across the slope.
    const first=sample(start),width=Math.abs((typeof to==='function'?to(first,start):to)-(typeof from==='function'?from(first,start):from));
    const cols=Math.max(1,Math.ceil(width/1.2));let distance=0,last;
    for(let i=0;i<=segments;i++) {
      const t=T.MathUtils.lerp(start,end,i/segments),s=sample(t);
      if(last)distance+=last.distanceTo(s.p);last=s.p;
      const a=typeof from==='function'?from(s,t):from,b=typeof to==='function'?to(s,t):to;
      for(let j=0;j<=cols;j++) {
        const offset=T.MathUtils.lerp(a,b,j/cols),p=point(s,offset,lift-.005);
        positions.push(...p.toArray());uv.push(offset/uvScale,distance/uvScale);
        const c=new T.Color(curb?(Math.floor(distance/1.2)%2?'#b82b27':'#e0bb21'):'#ffffff');colors.push(...c.toArray());
        if(i<segments&&j<cols){const k=i*(cols+1)+j;if(b>a)indices.push(k,k+cols+1,k+1,k+1,k+cols+1,k+cols+2);else indices.push(k,k+1,k+cols+1,k+1,k+cols+2,k+cols+1);}
      }
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    g.setIndex(indices);g.computeVertexNormals();return g;
  }
  return {curve,sample,point,measuredHeight,groundHeight,terrainGeometry,ribbonGeometry};
}
