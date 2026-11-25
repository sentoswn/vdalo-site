// Збір вакансій EWL з платформи WeLink (https://platform-prod.ewl.com.pl/recruitment/job-advertisements) — замість дошки Trello.
// Виконується у вкладці platform-prod.ewl.com.pl (користувач має бути залогінений; токен береться з localStorage сторінки й нікуди не передається).
// Сторінка не дає завантажити скрипт з GitHub (CSP), тому агент передає вміст файлу в javascript_tool повністю.
// Результат: window.__json, window.__b64 (gzip+base64url), window.__tr = {status:'done', n, noCity}.
// Формат вакансії — як у tools/trello.js (src:'trello' = вакансії EWL; так їх знають build.py і CRM).
// id тут ще немає: є eid (correlationId оголошення). Номер на сайті призначає tools/merge-ewl.js у вкладці github.com
// (за eid зі старого vacancies.json; нові — з лічильника ewlNext). Службові поля _e (наша сума за кандидата, zł) і _addr на сайт не потрапляють.
window.__tr={status:'running'};
(async()=>{try{
window.__pfb64=(location.hash.match(/[#&]p=([^&]+)/)||[])[1]||window.__pfb64||'';
const k=Object.keys(localStorage).find(k=>/-accesstoken-|accesstoken/i.test(k));if(!k)throw new Error('немає входу в EWL Platform');
const H={Authorization:'Bearer '+JSON.parse(localStorage.getItem(k)).secret};
const sel='id,status,correlationId,modifiedOn';const f=encodeURIComponent("((advertisementHasNoLanguageVersion eq false and status eq 'Published'))");
let tiles=[];for(let skip=0;skip<2000;skip+=100){const r=await fetch(`/job-advertisements/all-job-advertisements-tiles?$select=${sel}&$filter=${f}&$count=true&$top=100&$skip=${skip}`,{headers:H});if(r.status===401)throw new Error('сесія EWL Platform закінчилась — потрібно увійти');const j=await r.json();tiles=tiles.concat(j.value||[]);if(tiles.length>=j['@odata.count']||!(j.value||[]).length)break;}
const det=[];let qi=0;await Promise.all([0,1,2,3,4,5].map(async()=>{while(qi<tiles.length){const t=tiles[qi++];for(let a=0;a<3;a++){try{const r=await fetch('/job-advertisements/all-job-advertisements/current/'+t.correlationId+'?language=uk',{headers:{...H,'Accept-Language':'uk'}});if(r.ok){det.push(await r.json());break;}}catch(e){}await new Promise(r=>setTimeout(r,800));}}}));
if(!det.length)throw new Error('платформа не віддала жодного оголошення');
const LAB=['Локація','Місця','Заробітна плата','Місячна кількість годин','Бажане громадянство','Бажані громадянства','Тип договору','Тип контракту','Вікові обмеження','Можливість обговорення вікових обмежень','Приїзди','Спеціальні обмеження','Оптимізація','Про компанію','Опис вакансії','Опис посади','Обов’язки',"Обов'язки",'Вимоги','Умови на підприємстві','Умови на робочому місці','Адреса місця роботи','Опис місцевості виконання роботи','Нічні зміни','Позмінна робота','Система змін','Години та графік роботи','Години роботи та графік','Додаткові послуги \\(утримання\\)','Додаткові послуги \\(вирахування\\)','Можливість прямого приїзду на роботу','Транспорт до роботи','Проживання','Доплата за власне житло','Окремі кімнати для пар','Харчування','Пільги','Премії та фінансові надбавки','Luxmed','Робочий одяг','Перерви','Контактні особи','Контакти'];
const lre=new RegExp('(?:^|\\n)[\\s◾•-]*('+LAB.join('|')+')\\s*[:：][ \\t]*','gi');
const ent=s=>s.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&rsquo;/g,'’').replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&#x([0-9a-f]+);/gi,(m,h)=>String.fromCharCode(parseInt(h,16))).replace(/&#(\d+);/g,(m,d)=>String.fromCharCode(+d));
const txt=h=>ent((h||'').replace(/\r/g,'').replace(/<br\s*\/?>/gi,'\n').replace(/<li[^>]*>/gi,'\n- ').replace(/<\/(p|li|div|ul|ol|h\d)>/gi,'\n').replace(/<[^>]+>/g,'')).replace(/_{5,}/g,'\n').replace(/\*/g,'').replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n');
function parse(d){const m=[...d.matchAll(lre)];const o={};m.forEach((x,i)=>{const k=x[1].toLowerCase().replace(/[’']/g,"'");const end=i+1<m.length?m[i+1].index:d.length;const v=d.slice(x.index+x[0].length,end).trim();if(!o[k])o[k]=v;});return o;}
function first(t,n){t=(t||'').split(/\n\s*\n/)[0];t=t.replace(/^[\s\-–◾•]+/gm,'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n).replace(/\s\S*$/,'')+'…':t;}
function full(t,n){t=(t||'').replace(/^[\s\-–◾•]+/gm,'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n).replace(/\s\S*$/,'')+'…':t;}
const num=s=>parseFloat(String(s).replace(/\s/g,'').replace(',','.'));
const CUR=c=>/zł|зл|злот|pln/i.test(c)?'PLN':/€|євро|eur/i.test(c)?'EUR':/kč|czk/i.test(c)?'CZK':'';
function grossOf(s){const cm=(s||'').match(/PLN|EUR|CZK|€|Kč|злотих|зл/i);if(!cm)return null;const nums=(s.slice(0,cm.index).match(/\d[\d\s]*(?:[.,]\d+)?/g)||[]).map(num).filter(x=>x>0).slice(0,2);if(!nums.length)return null;return {min:Math.min(...nums),max:Math.max(...nums),unit:/год/i.test(s)?'год':'міс',cur:CUR(cm[0])};}
function netInfo(sal,firstLine){const g=grossOf(firstLine);if(!g)return null;const hr=[],mo=[];let upto=false,from=false;
 (sal||'').split(/\n|;|◾/).forEach(line=>{if(!/нетто|netto|чистими/i.test(line)||/прем|бонус|доплат|надбав|аванс|TRC|резидент|студент/i.test(line))return;
  const re=/(?:від\s*(\d[\d\s]*(?:[.,]\d+)?)\s*до\s*)?(\d[\d\s]*(?:[.,]\d+)?)(?:\s*[–-]\s*(\d[\d\s]*(?:[.,]\d+)?))?\s*(?:PLN|zł|злотих|зл|EUR|€|євро|CZK|Kč)?\.?\s*(?:нетто|netto)/gi;let m;
  while((m=re.exec(line))){const pre=line.slice(Math.max(0,m.index-18),m.index);if(/до\s*(?:приблизно\s*|близько\s*|≈\s*)?$/i.test(pre))upto=true;if(/від\s*$/i.test(pre))from=true;
   [m[1],m[2],m[3]].filter(Boolean).map(num).forEach(x=>{const big=g.cur==='CZK'?x>2000:x>200;
    if(!big&&g.unit==='год'){if(x<g.min*0.97&&x>g.min*0.6)hr.push(x);} else if(big){ if(g.unit==='год'||(x>=g.min*0.5&&x<=g.max))mo.push(x);} });}});
 const use=hr.length?hr:mo; if(!use.length)return null; const mn=Math.min(...use),mx=Math.max(...use);
 return [mn,mx,hr.length?'год':'міс',g.cur,mn===mx?(upto?'до':from?'від':''):''];}
const CTRY={'Poland':'Польща','Polska':'Польща','Lithuania':'Литва','Litwa':'Литва','Czech Republic':'Чехія','Czechy':'Чехія','Slovakia':'Словаччина','Słowacja':'Словаччина','Netherlands':'Нідерланди','Holandia':'Нідерланди','Germany':'Німеччина','Niemcy':'Німеччина'};
const today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
const dm=s=>{const d=new Date(s);return d.getUTCDate()+'.'+String(d.getUTCMonth()+1).padStart(2,'0');};
const items=det.map(a=>{const rp=(a.recruitmentProjects||[]).filter(p=>p.isActive!==false);
 const cur=p=>p.vacancies?.currentSumOfAllVacancies??p.numberOfVacancies??0;
 const act=rp.filter(p=>cur(p)>0&&(!p.projectEndDate||new Date(p.projectEndDate)>=today));
 const left=act.reduce((s,p)=>s+cur(p),0);
 const d=txt(a.advertisementWholeForCandidateViberHtml||a.advertisementWholeViberHtml||'');const p=parse(d);
 const sum=(f)=>act.reduce((s,x)=>s+(x.vacancies?.[f]||0),0);const w=sum('currentNumberOfWomanVacancies'),m=sum('currentNumberOfManVacancies'),an=sum('currentNumberOfAnyGenderVacancies');
 const g=a.allowGender==='Male'||(!w&&!an&&m)?'Чоловіки':a.allowGender==='Female'||(!m&&!an&&w)?'Жінки':'Жінки та чоловіки';
 const rate=x=>g==='Жінки'?(x.rateForFemale||0):(x.rateForMale||0);const _e=Math.round(Math.max(0,...(act.length?act:rp).map(x=>rate(x)*(x.bonusMultiplier&&x.bonusMultiplier>1?x.bonusMultiplier:1))));
 const mn=a.minAge||rp[0]?.minAge,mx=a.maxAge||rp[0]?.maxAge;
 const sal=p['заробітна плата']||'';let salFirst=sal.split('\n')[0];
 // платформа інколи пише місячну суму як «брутто/година» (напр. 4806.00 PLN брутто/година)
 salFirst=salFirst.replace(/(\d[\d.,]*)\s*(PLN|EUR|CZK)\s*брутто\/година/g,(m0,n,c)=>num(n)>(c==='CZK'?2000:200)?`${n} ${c} брутто/місяць`:m0);
 const loc=(p['локація']||'').split('\n')[0].replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim();
 const CYR={'Гданьск':'Gdańsk','Гданськ':'Gdańsk','Варшава':'Warszawa','Вроцлав':'Wrocław','Краків':'Kraków','Лодзь':'Łódź','Познань':'Poznań','Щецин':'Szczecin','Гдиня':'Gdynia','Катовіце':'Katowice'};
 let city=(loc&&loc.length<40&&!/\d/.test(loc)?loc:'')||rp[0]?.cityName||'';if(/[а-яіїєґ]/i.test(city))city=CYR[city]||rp[0]?.cityName||city;
 const _addr=[p['локація'],p['адреса місця роботи'],rp[0]?.cityName].filter(Boolean).map(x=>x.replace(/\s+/g,' ').slice(0,200)).join(' | ');
 const dates=[...new Set(act.map(x=>x.projectEndDate).filter(Boolean).sort().map(dm))];
 const sch=[p['позмінна робота']||p['система змін'],p['години та графік роботи']||p['години роботи та графік']].filter(x=>x&&!/^(так|ні)$/i.test(x.trim())).map(x=>full(x,300)).join('. ');
 const perks=[p['пільги'],p['премії та фінансові надбавки']].filter(Boolean).map(x=>full(x,450)).join(' ');
 const own=full(p['доплата за власне житло'],200);
 const r={eid:a.correlationId,src:'trello',title:(a.jobPositionName||a.jobPositionAdvertisementName||d.split('\n').map(x=>x.trim()).filter(Boolean)[0]||'').trim(),companyRaw:(a.orgUnitFriendlyName||a.companyShortName||'').trim(),companyName:a.companyName||'',aboutRaw:first(p['про компанію'],230),
  country:CTRY[rp[0]?.countryName]||rp[0]?.countryName||'',city,_addr,salary:first(salFirst,80),net:netInfo(sal,salFirst)||'',stud:(/студент/i.test(sal)&&/нетто|netto/i.test(sal))?1:'',
  hours:first(p['місячна кількість годин'],30).replace(/\s*-\s*/,'–'),contract:first(p['тип договору']||p['тип контракту'],50),housing:full(p['проживання'],700),food:full(p['харчування'],300),
  who:g+(mn>=18&&mx?`, ${mn}–${mx} р.`:''),trips:dates.length?'Приїзд '+dates.join(', '):'',desc:full(p['опис вакансії']||p['опис посади']||p["обов'язки"],900),schedule:sch,night:full(p['нічні зміни'],200),
  transport:full(p['транспорт до роботи'],500),req:full(p['вимоги'],700),perks,own:/^(ні|немає|-)?$/i.test(own)?'':own,age:mn>=18&&mx?[mn,mx]:[18,55],_e,left};
 Object.keys(r).forEach(k=>{if(r[k]===''||r[k]===false||r[k]==null)delete r[k];});return r;}).filter(o=>o.salary&&o.left>0);
// «Гарячі» — 20 оголошень з найбільшою нашою сумою за кандидата (при рівності — де більше місць).
items.slice().sort((a,b)=>(b._e-a._e)||(b.left-a.left)).slice(0,20).forEach(v=>{v.hot=true});
window.__json=JSON.stringify(items);
const s=new Blob([window.__json]).stream().pipeThrough(new CompressionStream('gzip'));const buf=new Uint8Array(await new Response(s).arrayBuffer());let b='';for(const x of buf)b+=String.fromCharCode(x);window.__b64=btoa(b).replace(/\+/g,'-').replace(/\//g,'_');
window.__tr={status:'done',ads:det.length,n:items.length,b64:window.__b64.length,planfix:window.__pfb64.length,noCity:items.filter(v=>!v.city).map(v=>v.eid+' '+v.companyRaw).join('; ')};
}catch(e){window.__tr={status:'error: '+(e&&e.message||e)};}})();
