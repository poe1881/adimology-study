import { isISODate } from './harmonic';
/** Explicit experimental policies, not universal definitions or certified/probabilistic signals. */
export const HARMONIC_REGISTRY_VERSION = 'experimental-weekly-ratios-v1';
export type HarmonicPattern = 'Gartley' | 'Bat' | 'ABCD' | 'Butterfly';
export interface ZigzagPivot { date:string; index:number; price:number; kind:'high'|'low'; confirmedAt?:string; provisional:boolean }
export interface HarmonicProjection {
 pattern:HarmonicPattern; direction:'bullish'|'bearish'; pivots:Partial<Record<'X'|'A'|'B'|'C'|'D',ZigzagPivot>>;
 ratios:Partial<Record<'AB_XA'|'BC_AB'|'AD_XA'|'CD_BC'|'CD_AB',number>>;
 prz:{low:number;high:number;evidence:string[]}; invalidation:{price:number;condition:string};
}
export interface HarmonicMatch extends HarmonicProjection { targets:{label:string;price:number;basis:string}[] }
type Band=readonly [number,number];
export interface HarmonicPolicy { policyVersion:string; references:readonly string[]; b?:Band; c:Band; ad?:Band; cdBC:Band; cdAB:Band; zones:2|3; note:string }
export const HARMONIC_REGISTRY:Readonly<Record<HarmonicPattern,HarmonicPolicy>> = {
 Gartley:{policyVersion:HARMONIC_REGISTRY_VERSION,references:['https://harmonictrader.com/harmonic-patterns/gartley-pattern/'],b:[.588,.648],c:[.382,.886],ad:[.766,.806],cdBC:[1.272,1.618],cdAB:[.95,1.05],zones:3,note:'Preserved existing Gartley bands; X hard boundary.'},
 Bat:{policyVersion:HARMONIC_REGISTRY_VERSION,references:['https://harmonictrader.com/harmonic-patterns/bat-pattern/'],b:[.382,.5],c:[.382,.886],ad:[.866,.906],cdBC:[1.618,2.618],cdAB:[1.2065,1.3335],zones:3,note:'Preserved strict Bat subset, extended AB=CD 1.27 ±5%; hard 1.13 XA.'},
 ABCD:{policyVersion:HARMONIC_REGISTRY_VERSION,references:['https://harmonictrader.com/harmonic-patterns/abcd-pattern/'],c:[.382,.886],cdBC:[1.13,2.618],cdAB:[.95,1.05],zones:2,note:'Actual four-point AB=CD; two-zone intersection only. No X/XA.'},
 Butterfly:{policyVersion:HARMONIC_REGISTRY_VERSION,references:['https://harmonictrader.com/harmonic-patterns/butterfly-pattern/'],b:[.756,.816],c:[.382,.886],ad:[1.24,1.30],cdBC:[1.618,2.618],cdAB:[1.2065,1.3335],zones:3,note:'Conservative chosen 1.27 ±.03 XA subset, NOT all Butterfly variants; D extends X, hard 1.618 XA and far PRZ boundary.'}
};
export const SUPPORTED_HARMONIC_PATTERNS=Object.keys(HARMONIC_REGISTRY) as HarmonicPattern[];
export function withinTolerance(value:number,target:number,tolerance:number):boolean {
 return [value,target,tolerance].every(Number.isFinite)&&target>0&&tolerance>=0&&Math.abs(value-target)<=target*tolerance+1e-9;
}
const inside=(v:number,b:Band)=>v>=b[0]-1e-9&&v<=b[1]+1e-9;
function valid(points:ZigzagPivot[],count:number):boolean {
 return Array.isArray(points)&&points.length===count&&points.every((p,i)=>!!p&&isISODate(p.date)&&Number.isFinite(p.price)&&p.price>0&&Number.isInteger(p.index)&&p.index>=0&&['high','low'].includes(p.kind)&&p.provisional===false&&!!p.confirmedAt&&isISODate(p.confirmedAt)&&p.confirmedAt>p.date&&(!i||(p.date>points[i-1].date&&p.index>points[i-1].index&&p.kind!==points[i-1].kind&&(p.kind==='high'?p.price>points[i-1].price:p.price<points[i-1].price))));
}
/** Projections require C already confirmed. Never invent a terminal D. */
export function projectHarmonicPRZ(points:ZigzagPivot[],pattern:HarmonicPattern):HarmonicProjection|null {
 const policy=HARMONIC_REGISTRY[pattern],abcd=pattern==='ABCD';
 if(!Object.hasOwn(HARMONIC_REGISTRY,pattern)||!valid(points,abcd?3:4)) return null;
 const [A,B,C]=abcd?points:points.slice(1),X=abcd?undefined:points[0];
 const s=A.kind==='high'?1:-1,ab=Math.abs(A.price-B.price),bc=Math.abs(C.price-B.price),xa=X?Math.abs(A.price-X.price):0;
 if(!inside(bc/ab,policy.c)||s*(A.price-C.price)<=0) return null;
 if(X&&(!inside(ab/xa,policy.b!)||s*(B.price-X.price)<=0)) return null;
 const zone=(anchor:number,length:number,band:Band)=>[anchor-s*length*band[0],anchor-s*length*band[1]].sort((a,b)=>a-b);
 const zones=[zone(C.price,bc,policy.cdBC),zone(C.price,ab,policy.cdAB)];
 const evidence=[`BC extension ${policy.cdBC.join('–')}`,`CD/AB ${policy.cdAB.join('–')}; ${policy.zones===2?'two':'three'}-zone intersection only`];
 if(X) {zones.unshift(zone(A.price,xa,policy.ad!));evidence.unshift(`AD/XA ${policy.ad!.join('–')}`);}
 const low=Math.max(...zones.map(z=>z[0])),high=Math.min(...zones.map(z=>z[1]));
 if(low>high||low<=0||(s===1?high>=B.price:low<=B.price)) return null;
 if(X&&(pattern==='Butterfly'?(s===1?high>=X.price:low<=X.price):(s===1?low<=X.price:high>=X.price))) return null;
 const price=pattern==='Gartley'?X!.price:pattern==='Bat'?A.price-s*1.13*xa:pattern==='Butterfly'?A.price-s*1.618*xa:s===1?low:high;
 if(!Number.isFinite(price)||price<=0) return null;
 return {pattern,direction:s===1?'bullish':'bearish',pivots:{...(X?{X}:{}),A,B,C},ratios:{...(X?{AB_XA:ab/xa}:{}),BC_AB:bc/ab},prz:{low,high,evidence},invalidation:{price,condition:pattern==='ABCD'?`Weekly ${s===1?'low strictly below':'high strictly above'} far PRZ boundary ${price} invalidates; equality remains eligible. No X/XA hard boundary. Not a guaranteed stop fill.`:`Weekly ${s===1?'low at/below':'high at/above'} hard boundary ${price}; far PRZ breach also invalidates. ${policy.note} Not a guaranteed stop fill.`}};
}
export function matchRegistryPivots(points:ZigzagPivot[],pattern:HarmonicPattern):HarmonicMatch|null {
 if(!valid(points,pattern==='ABCD'?4:5)) return null;
 const projection=projectHarmonicPRZ(points.slice(0,-1),pattern);if(!projection) return null;
 const D=points.at(-1)!,{A,B,C,X}=projection.pivots,s=projection.direction==='bullish'?1:-1;
 if(!inside(D.price,[projection.prz.low,projection.prz.high])||s*(C!.price-D.price)<=0||s*(B!.price-D.price)<=0) return null;
 const ab=Math.abs(A!.price-B!.price),bc=Math.abs(C!.price-B!.price),cd=Math.abs(C!.price-D.price);
 return {...projection,pivots:{...projection.pivots,D},ratios:{...projection.ratios,CD_BC:cd/bc,CD_AB:cd/ab,...(X?{AD_XA:Math.abs(A!.price-D.price)/Math.abs(A!.price-X.price)}:{})},targets:[.382,.618].map(r=>({label:`Tentative TP ${r}`,price:D.price+s*r*Math.abs(A!.price-D.price),basis:`D + direction × ${r} × |A−D|; scenario only, not guaranteed`}))};
}
