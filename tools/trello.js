// Збір вакансій з дошки Trello «EWL Partners» (викликає щоденне оновлення вакансій у вкладці trello.com).
// Результат: window.__json, window.__b64 (gzip+base64url), window.__tr = {status:'done', n, noCity:[...]}.
// Місто: шукаємо в «Локація», «Адреса (місця) роботи», «Місце роботи», «Місто» (поштові індекси PL/LT/NL/CZ/SK, останнє слово адреси);
// сирий текст адреси кладемо в _addr — якщо місто не знайшлось, агент визначає його вручну (поле з «_» на сайт не потрапляє).
window.__tr={status:'running'};
(async()=>{try{
window.__pfb64=(location.hash.match(/[#&]p=([^&]+)/)||[])[1]||'';
const r=await fetch('https://trello.com/b/ZFO3CX12.json?cards=open&lists=open&labels=all',{credentials:'include'});const j=await r.json();
const L=Object.fromEntries(j.lists.map(l=>[l.id,l.name]));const ok=n=>n&&!/^(🚫|ВАЖЛИВА|РЕЗЕРВ)/.test(n);
const C=['Польща','Литва','Чехія','Словаччина','Нідерланди','Німеччина','Україна'];
const LAB=['Локація','Заробітна плата','Ставки нетто','Місячна кількість годин','Бажані громадянства','Тип контракту','Тип договору','Вікові обмеження','Можливість узгодити вік індивідуально','Про компанію','Опис посади','Опис вакансії','Обов’язки',"Обов'язки",'Вимоги','Умови на робочому місці','Умови на підприємстві','Адреса місця роботи','Адреса роботи','Місце роботи','Місто','Опис місцевості виконання роботи','Нічні зміни','Система змін','Години роботи та графік','Графік роботи','Графік','Проживання','Харчування','Транспорт до роботи','Транспорт','Пільги','Додаткові послуги \\(вирахування\\)','Доплата за власне житло','Премії та фінансові надбавки','Спеціальні обмеження','Робочий одяг','Перерви','Правила легалізації','Позмінна робота','info','Оплата залежно від виконання норм продуктивності'];
const lre=new RegExp('(?:^|\\n)[\\s◾•-]*('+LAB.join('|')+')\\s*[:：]?[ \\t]*','gi');
function parse(d){d=d.replace(/\*\*|__|(?<![\w])_|_(?![\w])|###|\\/g,'');const m=[...d.matchAll(lre)];const o={};m.forEach((x,i)=>{const k=x[1].toLowerCase().replace(/[’']/g,"'");const end=i+1<m.length?m[i+1].index:d.length;const v=d.slice(x.index+x[0].length,end).replace(/^-{3,}$/gm,'').trim();if(!o[k])o[k]=v;});return o;}
function first(t,n){t=(t||'').split(/\n\s*\n/)[0];t=t.replace(/^[\s\-–◾•]+/gm,'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n).replace(/\s\S*$/,'')+'…':t;}
function full(t,n){t=(t||'').replace(/^[\s\-–◾•]+/gm,'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n).replace(/\s\S*$/,'')+'…':t;}
function cityOf(p){const fl=t=>(t||'').split('\n').map(s=>s.trim()).filter(Boolean)[0]||'';const a=[p['локація'],p['адреса місця роботи'],p['місце роботи'],p['адреса роботи'],p['місто']].filter(Boolean).map(fl).join('\n');const W='[A-ZĄĆĘŁŃÓŚŹŻŠŽČÁÉ][A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźżŠŽČĖĮŲŪšžčėįųūáčďéěíňóřšťúůýž\\-]+';let m=a.match(new RegExp('\\d{2}-\\d{3}\\s+('+W+'(?:\\s'+W+')?)'))||a.match(new RegExp('('+W+'),?\\s+LT-?\\d{5}'))||a.match(new RegExp('LT-?\\d{5},?\\s+('+W+')'))||a.match(new RegExp('('+W+')\\s+\\d{5}\\b'))||a.match(new RegExp('\\b\\d{4}\\s?[A-Z]{2}\\s+('+W+')'))||a.match(new RegExp('\\b\\d{3}\\s?\\d{2}\\s+('+W+'(?:\\s'+W+')?)'));if(m)return m[1];const loc=fl(p['локація']);if(loc&&loc.length<40)return loc;const parts=fl(p['адреса місця роботи']||p['місце роботи']||p['адреса роботи']).replace(/\(.*?\)/g,'').split(',').map(s=>s.trim()).filter(s=>/^[A-ZĄĆĘŁŃÓŚŹŻŠŽČ]/.test(s)&&!/\d/.test(s)&&!/^(ul|g|al)\.?\s/i.test(s)&&s.split(' ').length<=3);return parts.length?parts[parts.length-1]:'';}
const stripBrand=s=>s.replace(/\b[A-ZĄĆĘŁŃÓŚŹŻ0-9][A-ZĄĆĘŁŃÓŚŹŻ0-9&.\-]{2,}\b/g,'').replace(/(\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźżÀ-ž0-9&'’.\-]+)+\s*$/,'').replace(/\(\s*[A-Za-z][A-Za-z\s&.\-]*\)/g,'').replace(/\(\s*\)/g,'').replace(/\s{2,}/g,' ').replace(/[.\s,]+$/,'').trim();
const num=s=>parseFloat(String(s).replace(/\s/g,'').replace(',','.'));
const CUR=c=>/zł|зл|злот|pln/i.test(c)?'PLN':/€|євро|eur/i.test(c)?'EUR':/kč|czk/i.test(c)?'CZK':'';
function grossOf(s){const cm=(s||'').match(/PLN|EUR|CZK|€|Kč|злотих|зл/i);if(!cm)return null;const nums=(s.slice(0,cm.index).match(/\d[\d\s]*(?:[.,]\d+)?/g)||[]).map(num).filter(x=>x>0).slice(0,2);if(!nums.length)return null;return {min:Math.min(...nums),max:Math.max(...nums),unit:/год/i.test(s)?'год':'міс',cur:CUR(cm[0])};}
function netInfo(sal,firstLine){const g=grossOf(firstLine);if(!g)return null;const hr=[],mo=[];let upto=false,from=false;
 (sal||'').split(/\n|;|◾/).forEach(line=>{if(!/нетто|netto|чистими/i.test(line)||/прем|бонус|доплат|надбав|аванс|TRC|резидент/i.test(line))return;
  const re=/(?:від\s*(\d[\d\s]*(?:[.,]\d+)?)\s*до\s*)?(\d[\d\s]*(?:[.,]\d+)?)(?:\s*[–-]\s*(\d[\d\s]*(?:[.,]\d+)?))?\s*(?:PLN|zł|злотих|зл|EUR|€|євро|CZK|Kč)?\.?\s*(?:нетто|netto)/gi;let m;
  while((m=re.exec(line))){const pre=line.slice(Math.max(0,m.index-18),m.index);if(/до\s*(?:приблизно\s*|близько\s*|≈\s*)?$/i.test(pre))upto=true;if(/від\s*$/i.test(pre))from=true;
   [m[1],m[2],m[3]].filter(Boolean).map(num).forEach(x=>{const big=g.cur==='CZK'?x>2000:x>200;
    if(!big&&g.unit==='год'){if(x<g.min*0.97&&x>g.min*0.6)hr.push(x);} else if(big){ if(g.unit==='год'||(x>=g.min*0.5&&x<=g.max))mo.push(x);} });}});
 const use=hr.length?hr:mo; if(!use.length)return null; const mn=Math.min(...use),mx=Math.max(...use);
 return [mn,mx,hr.length?'год':'міс',g.cur,mn===mx?(upto?'до':from?'від':''):''];}
const items=j.cards.filter(c=>ok(L[c.idList])).map(c=>{const p=parse(c.desc||'');const list=L[c.idList];const labels=c.labels.map(l=>l.name);
const country=C.find(x=>list.startsWith(x))||C.find(x=>labels.includes(x))||'';
let nm=c.name.replace(/\n/g,' ').replace(/^[\s.⭐️★]+/u,'');let [head,...rest]=nm.split(/\.\s*(?=(?:Приїзд|Виїзд|Приезд))/i);
let title=stripBrand(head)||head;const up=(title.match(/[A-ZА-ЯІЇЄҐ]/g)||[]).length,lo=(title.match(/[a-zа-яіїєґ]/g)||[]).length;if(up>lo)title=title.toLowerCase();title=title.charAt(0).toUpperCase()+title.slice(1);
let trips=rest.join('. ').replace(/\(\s*множ[^)]*\)/gi,'').replace(/білет/gi,'квиток').replace(/Львову/g,'Львова').replace(/\s+([,.])/g,'$1').replace(/\s{2,}/g,' ').replace(/[,.\s]+$/,'').trim();
const g=list.includes('жінки')||labels.includes('Стать: жінки')?'Жінки':list.includes('чоловіки')||labels.includes('Стать: чоловіки')?'Чоловіки':'Жінки та чоловіки';
const ms=[...c.name.matchAll(/множ\.?\s*(\d+(?:[.,]\d+)?)/gi)].map(x=>num(x[1]));const _e=Math.round((ms.length?Math.max(...ms):1)*(g==='Жінки'?600:900)+(list.startsWith('ПРОЄКТ')?(g==='Жінки'?200:300):0));
const age=((p['вікові обмеження']||c.desc).match(/від\s*(\d{2})\s*до\s*(\d{2})/i)||[]);
const sal=(p['заробітна плата']||'')+'\n'+(p['ставки нетто']||'');const salFirst=(p['заробітна плата']||'').split('\n')[0];
const _addr=[p['локація'],p['адреса місця роботи'],p['адреса роботи'],p['місце роботи'],p['місто']].filter(Boolean).map(x=>x.replace(/\s+/g,' ').slice(0,200)).join(' | ');
const r={id:String(c.idShort),src:'trello',title,companyRaw:head,aboutRaw:first(p['про компанію'],230),country,city:cityOf(p),_addr,salary:first(salFirst,80),net:netInfo(sal,salFirst)||'',stud:(/студент/i.test(sal)&&/нетто|netto/i.test(sal))?1:'',hours:first(p['місячна кількість годин'],30),contract:first(p['тип контракту']||p['тип договору'],50),housing:full(p['проживання'],700),food:full(p['харчування'],300),who:g+(age[1]&&+age[1]>=18?`, ${age[1]}–${age[2]} р.`:''),trips,desc:full(p['опис посади']||p['опис вакансії']||p["обов'язки"],900),schedule:full(p['система змін']||p['графік роботи']||p['години роботи та графік']||p['графік'],500),night:full(p['нічні зміни'],200),transport:full(p['транспорт до роботи']||p['транспорт'],500),req:full(p['вимоги'],700),perks:full(p['пільги']||p['премії та фінансові надбавки'],900),_e,hot:c.name.trim().startsWith('⭐')||labels.includes('⭐️⭐️⭐️⭐️⭐️')||list.startsWith('ПРОЄКТ'),left:(()=>{const s=labels.map(l=>+((l.match(/від\s*(\d+)\+?\s*місць/i)||[])[1]||0)).filter(x=>x>0);return s.length?Math.max(...s)+'+':''})()};
Object.keys(r).forEach(k=>{if(r[k]===''||r[k]===false)delete r[k];});return r;}).filter(o=>o.salary);
window.__json=JSON.stringify(items);
const s=new Blob([window.__json]).stream().pipeThrough(new CompressionStream('gzip'));const buf=new Uint8Array(await new Response(s).arrayBuffer());let b='';for(const x of buf)b+=String.fromCharCode(x);window.__b64=btoa(b).replace(/\+/g,'-').replace(/\//g,'_');
window.__tr=Object.assign({status:'done'},({n:items.length,b64:window.__b64.length,planfix:window.__pfb64.length,noCity:items.filter(v=>!v.city).map(v=>v.id+' '+v.companyRaw).join('; ')}));
}catch(e){window.__tr={status:'error: '+(e&&e.message||e)};}})();
