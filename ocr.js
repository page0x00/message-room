let library;
function loadLibrary(){
  if(window.Tesseract)return Promise.resolve(window.Tesseract);
  return library ||= new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('./vendor/tesseract.js?v=6.0.1',import.meta.url).href;
    const timer=setTimeout(()=>{script.remove();library=null;reject(new Error('识别组件加载超时，请重试或粘贴文字。'));},30000);
    script.onload=()=>{clearTimeout(timer);resolve(window.Tesseract);};
    script.onerror=()=>{clearTimeout(timer);script.remove();library=null;reject(new Error('识别组件未能加载，请重试或粘贴文字。'));};
    document.head.append(script);
  });
}
export async function recognizeScreenshot(file,{signal,onProgress=()=>{}}={}){
  if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>16*1024*1024)throw new Error('请选择不超过 16 MB 的 JPG、PNG 或 WebP 截图。');
  let worker, timer, stopped=false, abort;
  const url=URL.createObjectURL(file);
  const interrupted=new Promise((_,reject)=>{
    abort=()=>{stopped=true;void worker?.terminate();reject(new DOMException('Cancelled','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{stopped=true;void worker?.terminate();reject(new Error('识别超时。请检查网络、裁短截图后重试，或粘贴相册识别的文字。'));},180000);
  });
  if(signal?.aborted)abort();
  try {
    return await Promise.race([interrupted,(async()=>{
      const image=new Image();image.src=url;await image.decode();
      if(image.naturalWidth*image.naturalHeight>24000000)throw new Error('截图过长，请裁成几段分别导入。');
      const scale=Math.min(1,4200/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
      const drawing=canvas.getContext('2d');drawing.fillStyle='#fff';drawing.fillRect(0,0,canvas.width,canvas.height);drawing.drawImage(image,0,0,canvas.width,canvas.height);
      const engine=await loadLibrary();if(stopped)throw new DOMException('Cancelled','AbortError');
      onProgress('正在加载中英文识别模型，首次可能需要一些时间……');
      worker=await engine.createWorker(['chi_sim','eng'],1,{
        workerPath:new URL('./vendor/tesseract-worker.js?v=6.0.1',import.meta.url).href,
        corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',
        langPath:'https://tessdata.projectnaptha.com/4.0.0',
        logger:event=>{if(!stopped)onProgress(event.status==='recognizing text'?`正在识别 ${Math.round(event.progress*100)}%`:'正在准备本机识别模型……');},
        errorHandler:()=>{},
      });
      if(stopped){await worker.terminate();throw new DOMException('Cancelled','AbortError');}
      const result=await worker.recognize(canvas,{}, {text:true,blocks:true});
      return {data:result.data,width:canvas.width};
    })()]);
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);stopped=true;await worker?.terminate();URL.revokeObjectURL(url);}
}
