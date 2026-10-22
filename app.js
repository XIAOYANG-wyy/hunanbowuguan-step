import * as THREE from 'three';

const host = document.getElementById('renderHost');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, host.clientWidth / host.clientHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(host.clientWidth, host.clientHeight);
host.appendChild(renderer.domElement);

const count = 1200;
const geo = new THREE.BufferGeometry();
const positions = new Float32Array(count * 3);
const originPos = new Float32Array(count * 3);
for(let i = 0; i < count; i++){
  const x = (Math.random()-0.5)*8;
  const y = (Math.random()-0.5)*8;
  const z = (Math.random()-0.5)*8;
  positions[i*3] = x;
  positions[i*3+1] = y;
  positions[i*3+2] = z;
  originPos[i*3] = x;
  originPos[i*3+1] = y;
  originPos[i*3+2] = z;
}
geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
const mat = new THREE.PointsMaterial({color:0xffdd88, size:0.08});
const points = new THREE.Points(geo, mat);
scene.add(points);
camera.position.z = 5;

let handModel = null;
let handX = 0, handY = 0;
let isFist = false;
const videoEl = document.getElementById('cameraVideo');

// 判断是不是握拳
function checkIsFist(landmarks){
  const tipIndices = [4,8,12,16,20];
  const baseIndices = [2,6,10,14,18];
  let foldCount = 0;
  for(let i=0;i<tipIndices.length;i++){
    const tip = landmarks[tipIndices[i]];
    const base = landmarks[baseIndices[i]];
    const dist = Math.hypot(tip[0]-base[0], tip[1]-base[1]);
    if(dist < 35) foldCount++;
  }
  return foldCount >= 4;
}

async function initHandPose(){
  handModel = await handpose.load();
  detectHand();
}
async function detectHand(){
  if(!handModel) return;
  const hands = await handpose.estimateHands(videoEl);
  if(hands.length > 0){
    const landmarks = hands[0].landmarks;
    const palm = hands[0].annotations.palmBase[0];
    handX = (palm[0] / videoEl.clientWidth - 0.5) * 8;
    handY = -(palm[1] / videoEl.clientHeight - 0.5) * 8;
    isFist = checkIsFist(landmarks);
  }else{
    isFist = false;
  }
  setTimeout(detectHand,50);
}

navigator.mediaDevices.getUserMedia({video:true})
.then(stream=>{
  videoEl.srcObject = stream;
  initHandPose();
})
.catch(err=>console.log("摄像头开启失败",err));

const posAttr = geo.attributes.position;
function animate(){
  requestAnimationFrame(animate);

  for(let i=0;i<count;i++){
    const ix = i*3;
    const dx = handX - posAttr.array[ix];
    const dy = handY - posAttr.array[ix+1];
    const dist = Math.sqrt(dx*dx+dy*dy);

    if(isFist && dist < 3.5){
      // 握拳：往掌心聚拢
      posAttr.array[ix] += dx * 0.04;
      posAttr.array[ix+1] += dy * 0.04;
    }else{
      // 张开手：回到原始位置散开
      posAttr.array[ix] += (originPos[ix] - posAttr.array[ix]) * 0.02;
      posAttr.array[ix+1] += (originPos[ix+1] - posAttr.array[ix+1]) * 0.02;
    }
  }
  posAttr.needsUpdate = true;

  points.rotation.y += 0.001;
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', ()=>{
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
})