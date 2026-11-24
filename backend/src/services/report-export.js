const writeExcel = require("write-excel-file/node");
const PDFDocument = require("pdfkit");
const { reject } = require("./vehicle-reports");

const TIME = new Set(["start","end"]);
const title = {
  trips:"Trip Report",stops:"Stops Report",mileage:"Mileage Report",activity:"Fleet Activity Report",
};
const vehicle = [["vehicle","Vehicle"],["registration","Registration"]];
const time = [["start","Start"],["end","End"]];
const columns = {
  trips:[...vehicle,...time,["startLocation","Start coordinates"],["endLocation","End coordinates"],
    ["distance","Distance (km)"],["duration","Duration (s)"],["averageSpeed","Avg (km/h)"],["maxSpeed","Max (km/h)"],["gaps","GPS gaps"]],
  stops:[...vehicle,...time,["startLocation","Coordinates"],["duration","Stop (s)"],["idle","Observed idle (s)"],["ignitionOff","Observed ignition off (s)"]],
  mileage:[...vehicle,["day","Trip start date"],["trips","Trips"],["distance","Distance (km)"],["moving","Movement (s)"],["partialDistance","Incomplete distance"]],
  activity:[...vehicle,["historyAvailable","History enabled"],["trips","Trips"],["distance","Distance (km)"],["moving","Movement (s)"],
    ["stopped","Stopped (s)"],["idle","Observed idle (s)"],["maxSpeed","Max (km/h)"],["partialDistance","Incomplete distance"]],
};
const types = {
  csv:"text/csv; charset=utf-8",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pdf:"application/pdf",
};
const safe = value => /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? "'"+value : value;

function clock(timezone) {
  const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",
    hourCycle:"h23",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"longOffset"});
  return value=>{
    const p=Object.fromEntries(formatter.formatToParts(new Date(value)).map(({type,value})=>[type,value]));
    return {wall:`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`,offset:p.timeZoneName};
  };
}
function cell(value,key,local,excel=false) {
  if(value==null)return null;
  if(TIME.has(key)){
    const {wall,offset}=local(value);
    return excel?new Date(wall.replace(" ","T")+"Z"):`${wall} ${offset}`;
  }
  if(Array.isArray(value))return value.map(n=>Number(n.toFixed(6))).join(", ");
  if(typeof value==="boolean")return value?"Yes":"No";
  return typeof value==="number"?Number(value.toFixed(6)):safe(String(value));
}
function describe(report,local) {
  const timezone=report.range.timezone;
  const date=value=>{const {wall,offset}=local(value);return `${wall} ${offset}`;};
  const totals=report.totals;
  const distance=totals.distance==null?"Unavailable":totals.distance.toFixed(3)+" km";
  const values=[
    ["SNA Fleet Management",title[report.type]],
    ["Period (start inclusive, end exclusive)",`${date(report.range.from)} to ${date(report.range.to)}`],
    ["Timezone",timezone],["Generated",date(new Date())],
    ["Vehicles",safe(report.vehicles.map(v=>v.registration?`${v.name} (${v.registration})`:v.name).join("; ")||"None")],
    ["Units","Kilometres, seconds, kilometres per hour, decimal-degree coordinates"],
    ["Report rows",report.totalRows],["Omitted or overlapping intervals",report.omitted],
  ];
  if(report.type!=="stops") values.push(["Trip totals",`${totals.trips} trips, ${distance}${totals.partialDistance?" (partial)":""}, ${totals.moving} s movement`]);
  if(["stops","activity"].includes(report.type)) values.push(["Stop totals",`${totals.stopped} s stopped, ${totals.idle??"unavailable"} s observed idle`]);
  return values;
}

async function exportReport(report,format) {
  if(!Object.hasOwn(types,format))reject(400,"Unsupported export format.");
  const limit=format==="pdf"?500:5000;
  if(report.totalRows>limit)reject(413,`This ${format.toUpperCase()} export is limited to ${limit} rows. Shorten the date range or select fewer vehicles.`);
  const local=clock(report.range.timezone);
  const base=columns[report.type];
  const excelOffsets=format==="xlsx"?base.filter(([key])=>TIME.has(key)).map(([key,label])=>[`${key}Offset`,`${label} UTC offset`]):[];
  const spec=[...base,...excelOffsets];
  const headers=spec.map(([,name])=>name);
  const rows=report.rows.map(row=>[
    ...base.map(([key])=>cell(row[key],key,local,format==="xlsx")),
    ...excelOffsets.map(([key])=>local(row[key.slice(0,-6)]).offset),
  ]);
  const metadata=describe(report,local);
  if(format==="csv"){
    const escape=value=>'"'+String(value??"").replaceAll('"','""')+'"';
    return {type:types.csv,body:Buffer.from("\uFEFF"+[...metadata,[],headers,...rows].map(row=>row.map(escape).join(",")).join("\r\n"))};
  }
  if(format==="xlsx"){
    const header=label=>({value:label,fontWeight:"bold",color:"#FFFFFF",backgroundColor:"#153F74"});
    const xlsxCell=value=>value==null?null:value instanceof Date?
      {value,type:Date,format:"yyyy-mm-dd hh:mm:ss"}:{value};
    const body=await writeExcel([
      {sheet:"Report details",columns:[{width:43},{width:90}],
        data:metadata.map((row,i)=>i===0?row.map(header):row.map(xlsxCell))},
      {sheet:title[report.type],stickyRowsCount:1,
        columns:spec.map(([key])=>({width:TIME.has(key)?23:key==="vehicle"?28:22})),
        data:[headers.map(header),...rows.map(row=>row.map(xlsxCell))]},
    ]).toBuffer();
    return {type:types.xlsx,body};
  }
  return {type:types.pdf,body:await pdf(metadata,headers,rows)};
}

function pdf(metadata,headers,rows) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:"A4",layout:"landscape",margin:30});
    const chunks=[];
    doc.on("data",chunk=>chunks.push(chunk));
    doc.on("error",reject);
    doc.on("end",()=>resolve(Buffer.concat(chunks)));
    const margin=30,width=doc.page.width-2*margin,column=width/headers.length;
    let y=margin,page=1;
    const heading=()=> {
      doc.fillColor("#153F74").font("Helvetica-Bold").fontSize(19).text("SNA Fleet Management",margin,y);
      doc.fontSize(14).text(metadata[0][1]);
      doc.font("Helvetica").fontSize(8).fillColor("#334155");
      doc.text(`Page ${page}  |  ${metadata[2][1]}  |  Distances in km`);
      y=doc.y+12;
    };
    const row=(cells,header=false,index=0)=>{
      const values=cells.map(v=>String(v??"Unavailable"));
      doc.font(header?"Helvetica-Bold":"Helvetica").fontSize(8);
      const height=Math.max(19,...values.map(v=>doc.heightOfString(v,{width:column-10})+10));
      if(!header&&y+height>doc.page.height-margin){
        doc.addPage();page++;y=margin;heading();row(headers,true);
      }
      doc.rect(margin,y,width,height).fill(header?"#153F74":index%2?"#F1F5F9":"#FFFFFF");
      doc.fillColor(header?"#FFFFFF":"#0F172A").font(header?"Helvetica-Bold":"Helvetica");
      values.forEach((value,i)=>doc.text(value,margin+i*column+5,y+5,{width:column-10,lineGap:0}));
      y+=height;
    };
    heading();
    for(const [label,value] of metadata.slice(1)){
      doc.text(`${label}  ${value}`,margin,y,{width});
      y=doc.y+3;
    }
    y+=8;row(headers,true);
    rows.forEach((values,i)=>row(values,false,i));
    doc.end();
  });
}
module.exports={exportReport,types};
