import {validDate,localDate} from './core.js?v=2.3.0';

export function screenshotTime(file){
  const match=String(file.name||'').match(/(?:19|20)\d{2}[-_.]?[01]\d[-_.]?[0-3]\d(?:[T_ .-]?[0-2]\d[-_.:]?[0-5]\d(?:[-_.:]?[0-5]\d)?)?/);
  if(match){const digits=match[0].replace(/\D/g,'');const date=`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;if(validDate(date)){const stamp=new Date(`${date}T${digits.slice(8,10)||'00'}:${digits.slice(10,12)||'00'}:${digits.slice(12,14)||'00'}`).getTime();if(Number.isFinite(stamp))return stamp;}}
  return Number(file.lastModified)||Date.now();
}
export function sortScreenshots(rows){return [...rows].sort((a,b)=>(a.time??screenshotTime(a))-(b.time??screenshotTime(b))||String(a.name).localeCompare(String(b.name),undefined,{numeric:true}));}
export function slices(height,width){
  const size=Math.max(1000,Math.min(2200,Math.round(width*2))),overlap=Math.min(320,Math.round(width*.22)),rows=[];
  for(let y=0;y<height;){const h=Math.min(size,height-y);rows.push({y,height:h});if(y+h>=height)break;y+=h-overlap;}
  return rows;
}
export function cleanOcrText(value){return String(value||'').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1').replace(/[ \t]+([，。！？；：、])/g,'$1').trim();}
export function chatDate(value,anchor=localDate()){
  const text=cleanOcrText(value).replace(/\s/g,'').replace(/[OoＯ]/g,'0');
  const absolute=text.match(/^(?:(\d{4})[年/.-])?(\d{1,2})[月/.-](\d{1,2})(?:日)?(?:星期[一二三四五六日天]|周[一二三四五六日天])?(?:[上下]午)?(?:\d{1,2}[:：]\d{2})?$/);
  if(absolute){let year=Number(absolute[1]||anchor.slice(0,4));let date=`${year}-${absolute[2].padStart(2,'0')}-${absolute[3].padStart(2,'0')}`;if(!absolute[1]&&date>anchor&&Number(absolute[2])>Number(anchor.slice(5,7))+6)date=`${year-1}${date.slice(4)}`;return validDate(date)?{date,source:'聊天日期'}:null;}
  const relative=text.match(/^(今天|昨天|前天)(?:[上下]午)?(?:\d{1,2}[:：]\d{2})?$/);
  if(relative){const day=new Date(anchor+'T12:00:00');day.setDate(day.getDate()-({今天:0,昨天:1,前天:2}[relative[1]]));return {date:localDate(day),source:'聊天相对日期'};}
  const weekday=text.match(/^(?:星期|周)([一二三四五六日天])(?:[上下]午)?(?:\d{1,2}[:：]\d{2})?$/);
  if(weekday){const day=new Date(anchor+'T12:00:00'),wanted={日:0,天:0,一:1,二:2,三:3,四:4,五:5,六:6}[weekday[1]];day.setDate(day.getDate()-(day.getDay()-wanted+7)%7);return {date:localDate(day),source:'聊天星期（按截图日期推算）'};}
  return null;
}
export function splitText(text,max=4400){const rows=[];let rest=String(text);while(rest.length>max){let end=rest.lastIndexOf('\n',max);if(end<max/2)end=max;rows.push(rest.slice(0,end));rest=rest.slice(end).replace(/^\n/,'');}if(rest.trim())rows.push(rest);return rows;}
const colorDistance=(a,b)=>Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]));
// Tiny punctuation has too few strokes for the language model. Only accept an
// isolated dot/ring near the baseline; never infer letters from a bubble border.
export function isolatedDot({data,width:w,height:h}){
  const seen=new Uint8Array(w*h),parts=[];
  for(let start=0;start<w*h;start++){
    if(seen[start]||data[start*4]>100)continue;const todo=[start];seen[start]=1;let minX=w,maxX=0,minY=h,maxY=0,count=0,touches=false;
    for(let n=0;n<todo.length;n++){const i=todo[n],x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++;if(x<2||x>w-3||y<2||y>h-3)touches=true;for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(xx<0||xx>=w||yy<0||yy>=h)continue;const j=yy*w+xx;if(!seen[j]&&data[j*4]<100){seen[j]=1;todo.push(j);}}}
    if(!touches&&count>3)parts.push({minX,maxX,minY,maxY,count});
  }
  if(parts.length!==1)return null;const p=parts[0],pw=p.maxX-p.minX+1,ph=p.maxY-p.minY+1;
  if(pw>h*.24||ph>h*.24||ph<3||pw/ph<.6||pw/ph>1.6||p.minY<h*.4)return null;
  const center=(Math.round((p.minY+p.maxY)/2)*w+Math.round((p.minX+p.maxX)/2))*4;
  return data[center]>150?'。':'.';
}

// Analyze flat rectangles before OCR. Wallpaper and avatars stay outside the text canvas.
export function bubbleRegions(image,{first=true,last=true}={}){
  const {width:w,height:h,data}=image;
  const color=(x,y)=>{const p=(Math.max(0,Math.min(h-1,y))*w+Math.max(0,Math.min(w-1,x)))*4;return [data[p],data[p+1],data[p+2]];};
  const edge=y=>{if([.02,.98].some(k=>colorDistance(color(Math.round(w*k),y),color(Math.round(w*k),y-2))<12))return 0;let different=0,count=0;for(let x=5;x<w-5;x+=9){if(colorDistance(color(x,y),color(x,y-2))>12)different++;count++;}return different/count;};
  let top=first?Math.round(w*.032):0,bottom=h;
  if(first)for(let y=Math.round(w*.045);y<Math.min(h*.25,w*.3);y++)if(edge(y)>.7)top=y+1;
  if(last)for(let y=Math.max(top+20,h-Math.round(w*.18));y<h-2;y++)if(edge(y)>.7){bottom=y-2;break;}
  const candidates=[],minWidth=Math.max(16,w*.035),maxWidth=w*.88;
  function matchRow(y,x0,x1,fill,tolerance){let same=0,total=0;for(let x=x0+2;x<x1-2;x+=3){same+=colorDistance(color(x,y),fill)<tolerance;total++;}return total>0&&same/total>.35&&colorDistance(color(x0+3,y),fill)<tolerance&&colorDistance(color(x1-3,y),fill)<tolerance;}
  for(let y=top+2;y<bottom-2;y+=2){
    let x=Math.round(w*.064);
    while(x<w*.94){
      const x0=x,fill=color(x,y);x++;
      const backgroundDifference=Math.min(colorDistance(fill,color(1,y)),colorDistance(fill,color(w-2,y))),tolerance=Math.max(8,Math.min(30,backgroundDifference*.55));
      while(x<w*.94&&colorDistance(color(x,y),fill)<tolerance)x++;
      const x1=x,span=x1-x0,cx=(x0+x1)/2;
      const boundary=Math.max(8,Math.min(22,backgroundDifference*.5));
      if(span<minWidth||span>maxWidth||colorDistance(color(x0-3,y),fill)<boundary||colorDistance(color(x1+2,y),fill)<boundary)continue;
      if(candidates.some(r=>y>=r.y0&&y<=r.y1&&x0>=r.x0-3&&x1<=r.x1+3))continue;
      let y0=y,y1=y;while(y0>top&&matchRow(y0-1,x0,x1,fill,tolerance))y0--;while(y1<bottom-1&&matchRow(y1+1,x0,x1,fill,tolerance))y1++;
      const height=y1-y0;if(height<w*.02||height<9||height>span*15)continue;
      const middle=cx>w*.32&&cx<w*.68,side=x0<w*.23?'left':x1>w*.77?'right':'unknown';
      const kind=middle&&span<w*.45&&height<w*.065&&side==='unknown'?'date':'bubble';
      if(kind==='bubble'&&(side==='unknown'||span<w*.043))continue;
      let border=0;for(const yy of [.15,.35,.5,.65,.85].map(k=>Math.round(y0+height*k)))if(colorDistance(color(x0-3,yy),fill)>boundary||colorDistance(color(x1+2,yy),fill)>boundary)border++;
      if(border<3)continue;candidates.push({x0,x1,y0,y1,fill,side,kind});
    }
  }
  // JPEG compression may divide one flat bubble into adjacent horizontal strips.
  for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
    const a=candidates[i],b=candidates[j];if(a.side===b.side&&a.kind===b.kind&&Math.abs(a.x0-b.x0)<6&&Math.abs(a.x1-b.x1)<6&&Math.max(a.y0,b.y0)-Math.min(a.y1,b.y1)<4&&colorDistance(a.fill,b.fill)<20){a.y0=Math.min(a.y0,b.y0);a.y1=Math.max(a.y1,b.y1);candidates.splice(j--,1);}
  }
  const regions=[];
  for(const r of candidates.sort((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)-(a.x1-a.x0)*(a.y1-a.y0))){
    if(regions.some(p=>{const iw=Math.max(0,Math.min(p.x1,r.x1)-Math.max(p.x0,r.x0)),ih=Math.max(0,Math.min(p.y1,r.y1)-Math.max(p.y0,r.y0));return iw*ih/((r.x1-r.x0)*(r.y1-r.y0))>.65;}))continue;
    regions.push(r);
  }
  return {regions:regions.sort((a,b)=>a.y0-b.y0),top,bottom};
}
export function paragraphs(data){return (data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(p=>p.lines?.length?p.lines:[p])).map(line=>({...line,text:cleanOcrText(line.text||(line.words||[]).map(w=>w.text).join(' '))})).filter(line=>line.text);}
export function mergeTileRows(rows){
  const result=[];
  for(const row of [...rows].sort((a,b)=>a.y-b.y||a.x-b.x)){
    const overlapping=result.find(prior=>prior.side===row.side&&prior.kind===row.kind&&prior.lines?.length&&row.lines?.length&&Math.min(prior.y+prior.height,row.y+row.height)-Math.max(prior.y,row.y)>Math.min(prior.height,row.height)*.35&&Math.abs(prior.x-row.x)<35);
    if(overlapping){
      for(const line of row.lines){const same=overlapping.lines.find(p=>Math.abs(p.y-line.y)<Math.max(5,Math.min(p.height,line.height)*.6));if(!same)overlapping.lines.push(line);else if(line.confidence>same.confidence)Object.assign(same,line);}
      overlapping.height=Math.max(overlapping.y+overlapping.height,row.y+row.height)-overlapping.y;
      overlapping.lines.sort((a,b)=>a.y-b.y);overlapping.text=cleanOcrText(overlapping.lines.map(l=>l.text).join('\n'));overlapping.confidence=overlapping.lines.reduce((n,l)=>n+l.confidence,0)/overlapping.lines.length;continue;
    }
    const same=result.find(prior=>prior.side===row.side&&Math.abs(prior.y-row.y)<Math.max(18,Math.min(prior.height||30,row.height||30)*.55)&&prior.text.replace(/\s/g,'')===row.text.replace(/\s/g,''));
    if(same){if(row.confidence>same.confidence)Object.assign(same,row);continue;}result.push(row);
  }
  return result;
}
export function dateMessages(rows,anchor){
  let date=anchor,source='截图日期（未见聊天日期）',time='';const result=[];
  for(const row of mergeTileRows(rows)){
    const parsed=chatDate(row.text,anchor),clock=row.text.match(/^(?:[上下]午\s*)?(\d{1,2}[:：]\d{2})(?::\d{2})?$/);
    if(row.kind==='date'||row.side==='unknown'){
      if(parsed){date=parsed.date;source=parsed.source;time=row.text.match(/\d{1,2}[:：]\d{2}/)?.[0]||'';continue;}
      if(clock){time=clock[1].replace('：',':');continue;}
      if(row.kind==='date')continue;
    }
    for(const text of splitText(row.text))result.push({...row,text,date,dateSource:source,time});
  }
  return result;
}
