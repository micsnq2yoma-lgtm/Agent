export const A='http://127.0.0.1:3100/api';
export async function api(method, path, body){
  const r = await fetch(A+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const t = await r.text(); let j; try{j=JSON.parse(t)}catch{j=t}
  if(!r.ok) throw new Error(`${method} ${path} ${r.status} ${t.slice(0,500)}`);
  return j;
}
