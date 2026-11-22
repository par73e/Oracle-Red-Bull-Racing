import * as T from 'three';

// The published bottom-layer sampling window, in solver coordinates. Keep
// this window when a solved whole-car field supplies the velocity, even if
// the optional refined underbody asset has yet to load.
const FLOOR_MIN = [-1.8, -1.4, .01];
const FLOOR_MAX = [4, 1.4, .45];
export function floorBoundary(point) {
 if (-point.z < FLOOR_MIN[0] || -point.z > FLOOR_MAX[0]) return 'x';
 if (-point.x < FLOOR_MIN[1] || -point.x > FLOOR_MAX[1]) return 'y';
 if (point.y - .005 < FLOOR_MIN[2] || point.y - .005 > FLOOR_MAX[2]) return 'z';
 return null;
}

export function floorSeeds(state, rig, airflow) {
  const windAngle = state.effWindAngle ?? state.windAngle ?? 0;
  const {nearby} = airflow.getRayContext(rig.model);
  const nx=Math.max(1,Math.round(21*Math.sqrt(state.flowDensity/100))),ny=Math.max(1,Math.round(4*Math.sqrt(state.flowDensity/100)));
  // Preserve the front rake through shallow yaw, then move it toward the
  // windward side. The rake stays within the fine grid with the same seed budget.
  const rakeAngle = windAngle * T.MathUtils.smoothstep(Math.abs(windAngle), 5, 20);
  const rakeRadians = T.MathUtils.degToRad(rakeAngle);
  const rakeCos = Math.cos(rakeRadians), rakeSin = Math.sin(rakeRadians);
  const lateralWeight = Math.abs(rakeAngle) / 90;
  const seedX = -.95 * rakeAngle / 90;
  const seedZ = 1.78 * (1 - lateralWeight);
  const halfWidth = T.MathUtils.lerp(.72, 1.5, lateralWeight);
  const seeds = [];
  for (let j = 0; j < ny; j++) {
   for (let i = 0; i < nx; i++) {
    const offset = halfWidth - 2 * halfWidth * (i + .5) / nx;
    seeds.push(new T.Vector3(seedX + rakeCos * offset, .035 + .07 * (j + .5) / ny + .005, seedZ + rakeSin * offset));
   }
  }
  if (state.model === 'rb19') {
   // A front rake alone misses fluid inside the floor when its paths exit the
   // sampled passage early. Place two fixed local rakes under the floor and
   // use the same field and collision checks as the front rake.
   const yawWeight = 1 - T.MathUtils.smoothstep(Math.abs(windAngle), 5, 30);
   const columns = Math.round(nx * .5 * yawWeight);
   const rows = Math.max(1, Math.round(ny * .5));
   const up = new T.Vector3(0, 1, 0);
   for (const z of [.25, -.9]) {
    for (let j = 0; j < rows; j++) {
     for (let i = 0; i < columns; i++) {
      const seed = new T.Vector3(-.69 + 1.38 * (i + .5) / columns, .038 + .043 * (j + .5) / rows, z);
      if (airflow.hasRayHit(seed, up, .23, nearby(seed))) seeds.push(seed);
     }
    }
   }
  }
  return seeds;
}

export function sideSeeds(state, rig, airflow) {
  const {all} = airflow.getRayContext(rig.model);
  const point = new T.Vector3(), direction = new T.Vector3();
  const sides=Math.max(1,Math.round(6*Math.sqrt(state.flowDensity/100))),heights=Math.max(1,Math.round(6*Math.sqrt(state.flowDensity/100)));
  const candidates=[];
  for(const sign of [-1,1])for(let j=0;j<heights;j++)for(let i=0;i<sides;i++){
   const solverY=sign*(.28+.90*(i+.5)/sides),solverZ=.14+.94*(j+.5)/heights;
   candidates.push({name:'suspension',position:new T.Vector3(-solverY,solverZ+.005,2.05)});
  }
  // Additional local seeds around the actual articulated front track rods.
  // The existing proxy validity mask and collision tests still apply.
  const invParent=airflow.parent?new T.Matrix4().copy(airflow.parent.matrixWorld).invert():null;
  for(const name of ['FL','FR']){const link=rig.links?.[name];if(!link)continue;
   const inner=link.innerNode.getWorldPosition(new T.Vector3()),outer=link.outerNode.getWorldPosition(new T.Vector3());
   if(invParent){inner.applyMatrix4(invParent);outer.applyMatrix4(invParent);}
   const axis=outer.clone().sub(inner).normalize(),a=new T.Vector3().crossVectors(axis,new T.Vector3(0,1,0)).normalize(),b=new T.Vector3().crossVectors(axis,a).normalize();
   if(a.lengthSq()<.5||b.lengthSq()<.5)continue;
   for(const t of [.3,.55,.8])for(const d of [a,a.clone().negate(),b,b.clone().negate()])for(const radius of [.045,.085]){
    const center=inner.clone().lerp(outer,t);candidates.push({name:'suspension',position:center.addScaledVector(d,radius),escape:d.clone()});
   }
  }
  // Probe from outside towards the actual displayed surfaces.  Seed short
  // distances outside each first hit, then require a valid CFD fluid sample.
  const probeLevels=Math.max(1,Math.round(7*Math.sqrt(state.flowDensity/100)));
  for(const station of [{x:-.55,name:'sidepod'},{x:.15,name:'sidepod'},{x:.85,name:'sidepod'},{x:1.55,name:'sidepod'},{x:-1.65,name:'suspension'}])for(const sign of [-1,1])for(let j=0;j<probeLevels;j++){
   const z=.17+.83*(j+.5)/probeLevels,outer=station.name==='suspension'?.54:1.23;
   const hit=airflow.firstRayHit(point.set(-sign*outer,z+.005,-station.x),direction.set(sign,0,0),.0001,outer-.16,all);if(!hit)continue;
   for(const offset of [.04,.09])candidates.push({name:station.name,position:hit.point.clone().add(new T.Vector3(-sign*offset,0,0))});
  }
  return candidates;
}
