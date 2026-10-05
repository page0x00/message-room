// Tagore, Stray Birds (1916); Chinese: Zheng Zhenduo (1922), public domain.
// The three marked excerpts stop at a complete sentence; no generated quotations.
const chinese='https://zh.wikisource.org/wiki/飛鳥集';
const english='https://www.gutenberg.org/files/6524/6524-h/6524-h.htm';
export const POEMS=[
 [1,'夏天的飞鸟，飞到我的窗前唱歌，又飞去了。','Stray birds of summer come to my window to sing and fly away.',true],
 [2,'世界上的一队小小的漂泊者呀，请留下你们的足印在我的文字里。','O troupe of little vagrants of the world, leave your footprints in my words.'],
 [3,'它变小了，小如一首歌，小如一回永恒的接吻。','It becomes small as one song, as one kiss of the eternal.',true],
 [4,'是大地的泪点，使她的微笑保持着青春不谢。','It is the tears of the earth that keep her smiles in bloom.'],
 [6,'如果你因失去了太阳而流泪，那么你也将失去群星了。','If you shed tears when you miss the sun, you also miss the stars.'],
 [9,'有一次，我们梦见大家都是不相识的。我们醒了，却知道我们原是相亲相爱的。','Once we dreamt that we were strangers. We wake up to find that we were dear to each other.'],
 [10,'忧思在我的心里平静下去，正如暮色降临在寂静的山林中。','Sorrow is hushed into peace in my heart like the evening among the silent trees.'],
 [13,'静静地听，我的心呀，听那世界的低语，这是它对你求爱的表示呀。','Listen, my heart, to the whispers of the world with which it makes love to you.'],
 [16,'我今晨坐在窗前，世界如一个路人似的，停留了一会，向我点点头又走过去了。','I sit at my window this morning where the world like a passer-by stops for a moment, nods to me and goes.'],
 [18,'你看不见你自己，你所看见的只是你的影子。','What you are you do not see, what you see is your shadow.'],
 [20,'我不能选择那最好的。是那最好的选择我。','I cannot choose the best. The best chooses me.'],
 [22,'我的存在，对我是一个永久的神奇，这就是生活。','That I exist is a perpetual surprise which is life.'],
 [24,'休息与工作的关系，正如眼睑与眼睛的关系。','Rest belongs to the work as the eyelids to the eyes.'],
 [25,'人是一个初生的孩子，他的力量，就是生长的力量。','Man is a born child, his power is the power of growth.'],
 [28,'啊，美呀，在爱中找你自己吧，不要到你镜子的谄谀去找寻。','O Beauty, find thyself in love, not in the flattery of thy mirror.'],
 [30,'“月儿呀，你在等候什么呢？”“向我将让位给他的太阳致敬。”','“Moon, for what do you wait?” “To salute the sun for whom I must make way.”'],
 [31,'绿树长到了我的窗前，仿佛是喑哑的大地发出的渴望的声音。','The trees come up to my window like the yearning voice of the dumb earth.'],
 [33,'生命从世界得到资产，爱情使它得到价值。','Life finds its wealth by the claims of the world, and its worth by the claims of love.'],
 [35,'鸟儿愿为一朵云。云儿愿为一只鸟。','The bird wishes it were a cloud. The cloud wishes it were a bird.'],
 [36,'瀑布歌唱道：“我得到自由时便有了歌声了。”','The waterfall sings, “I find my song, when I find my freedom.”'],
 [39,'当太阳横过西方的海面时，对着东方留下他的最后的敬礼。','The sun goes to cross the Western sea, leaving its last salutation to the East.'],
 [41,'群树如表示大地的愿望似的，踮起脚来向天空窥望。','The trees, like the longings of the earth, stand a-tiptoe to peep at the heaven.'],
 [42,'你微微地笑着，不同我说什么话。而我觉得，为了这个，我已等待得久了。','You smiled and talked to me of nothing and I felt that for this I had been waiting long.'],
 [48,'群星不怕显得象萤火那样。','The stars are not afraid to appear like fireflies.'],
 [54,'我们如海鸥之与波涛相遇似的，遇见了，走近了。','Like the meeting of the seagulls and the waves we meet and come near.',true]
].map(([verse,zh,en,excerpt=false])=>Object.freeze({id:'stray-'+verse,verse,zh,en,excerpt,author:'泰戈尔',translator:'郑振铎',work:'飞鸟集',source:chinese+'#'+(verse===4?'４':verse),original:english}));
const key='mailbox.poetry.visit.v1';let visit=null,started=false,hiddenAt=0;
export function nextPoemIndex(previous,length=POEMS.length,random=Math.random){return Number.isInteger(previous)&&previous>=0&&previous<length?(previous+1)%length:Math.min(length-1,Math.floor(random()*length));}
function nextVisit(){let previous=null;try{const raw=localStorage.getItem(key);if(raw!==null)previous=Number(raw);}catch{}visit=nextPoemIndex(previous);try{localStorage.setItem(key,String(visit));}catch{}return visit;}
export function poem(slot=0){if(visit===null)nextVisit();return POEMS[(visit+Math.abs(Number(slot)||0))%POEMS.length];}
export function applyPoetry(root=document){
 for(const el of root.querySelectorAll('[data-poem]')){const p=poem(el.dataset.poem),part=el.dataset.poemPart||'zh';el.dataset.poemId=p.id;el.title=`泰戈尔《飞鸟集》第 ${p.verse} 则${p.excerpt?'（节选）':''} · 郑振铎译`;
  el.textContent=part==='source'?`泰戈尔 ·《飞鸟集》${p.verse}${p.excerpt?' · 节选':''}`:p[part]||p.zh;
  if(el.tagName==='A'){el.href=p.source;el.target='_blank';el.rel='noopener noreferrer';}
 }
}
export function poetryMarkup(slot=0,bilingual=false){const n=Math.abs(Number(slot)||0);return `<blockquote class="poetry"><p data-poem="${n}"></p>${bilingual?`<small lang="en" data-poem="${n}" data-poem-part="en"></small>`:''}<a data-poem="${n}" data-poem-part="source"></a></blockquote>`;}
export function initPoetry(){if(started)return;started=true;applyPoetry();const refresh=()=>{nextVisit();applyPoetry();};document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenAt=Date.now();else if(hiddenAt&&Date.now()-hiddenAt>30000){hiddenAt=0;refresh();}});window.addEventListener('pageshow',e=>{if(e.persisted)refresh();});window.addEventListener('online',refresh);document.addEventListener('mailbox:account-identity',e=>{if(e.detail?.authenticated)refresh();});}
