const point = (p) => Array.isArray(p) && p.length === 2 &&
  p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
const orientation = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a, b, p) => orientation(a,b,p) === 0 && a.every((v,i) =>
  p[i] >= Math.min(v,b[i]) && p[i] <= Math.max(v,b[i]));
function intersects(a,b,c,d) {
  return onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b) ||
    (orientation(a,b,c) * orientation(a,b,d) < 0 && orientation(c,d,a) * orientation(c,d,b) < 0);
}
function geometry(input) {
  if (input?.type === "circle" && point(input.center) &&
      Number.isInteger(input.radius) && input.radius >= 10 && input.radius <= 100000) {
    return { type: "circle", center: input.center, radius: input.radius };
  }
  const v = input?.vertices;
  if (input?.type !== "polygon" || !Array.isArray(v) ||
      v.length < 3 || v.length > 100 || !v.every(point) ||
      new Set(v.map(p => p.join(","))).size !== v.length ||
      Math.max(...v.map(p=>p[1])) - Math.min(...v.map(p=>p[1])) >= 180 ||
      v.every(p => orientation(v[0],v[1],p) === 0)) return null;
  for (let i=0;i<v.length;i++) {
    for (let j=i+2;j<v.length;j++) {
      if (i === 0 && j === v.length-1) continue;
      if (intersects(v[i],v[(i+1)%v.length],v[j],v[(j+1)%v.length])) return null;
    }
  }
  return { type: "polygon", vertices: v };
}
function contains(fence, p) {
  if (fence.type === "circle") {
    const radians = Math.PI / 180;
    const [lat,lon] = fence.center;
    const a = Math.sin((p[0]-lat)*radians/2)**2 +
      Math.cos(lat*radians)*Math.cos(p[0]*radians)*Math.sin((p[1]-lon)*radians/2)**2;
    return 12742000*Math.asin(Math.sqrt(Math.min(1,a))) <= fence.radius;
  }
  let inside = false;
  const v = fence.vertices;
  for (let i=0,j=v.length-1;i<v.length;j=i++) {
    if (onSegment(v[i],v[j],p)) return true;
    if ((v[i][0]>p[0]) !== (v[j][0]>p[0]) &&
      p[1] < (v[j][1]-v[i][1])*(p[0]-v[i][0])/(v[j][0]-v[i][0])+v[i][1]) inside=!inside;
  }
  return inside;
}
module.exports = { geometry, contains, point };
