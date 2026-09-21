import {randomId} from './core.js?v=2.3.0';
import {splitText} from './ocr-layout.js?v=2.3.0';
export const imageFile=file=>/\.(png|jpe?g|webp)$/i.test(file.name)||/^image\/(png|jpeg|webp)$/.test(file.type);
export function selectedDrafts(rows,side='all'){return rows.filter(row=>!row.sent&&row.selected!==false&&(side==='all'||row.side===side));}
export function importUnits(rows,mode='separate'){
  const result=[];let merged=null;
  for(const row of rows){
    if(mode==='merged'&&!row.fileMeta){
      const entry=`${row.label}${row.time?' · '+row.time:''}\n${row.text}`;
      for(const text of splitText(entry,4400)){
        if(!merged||merged.date!==row.date||merged.text.length+text.length+2>4700){merged={nonce:randomId(),rows:[],text:'【截图合并整理】',label:'合并整理',date:row.date||'',sent:false,attempted:false};result.push(merged);}
        merged.rows.push(row.nonce);merged.text+='\n\n'+text;
      }
    }else{merged=null;for(const text of splitText(row.text,4700))result.push({nonce:randomId(),rows:[row.nonce],text,label:row.label,date:row.date||'',fileMeta:row.fileMeta,fileRow:row.nonce,sent:false,attempted:false});}
  }
  return result;
}
export async function* directoryFiles(handle,path=''){
  for await(const entry of handle.values()){
    if(entry.kind==='directory'){yield* directoryFiles(entry,path+entry.name+'/');}
    else{const file=await entry.getFile();if(imageFile(file))yield {file,path:path+file.name};}
  }
}
