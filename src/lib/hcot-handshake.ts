export type Plan = {id:number;title:string;status:string}
export type Programme = {id:number;name:string}
export type Link = {plan_id:number;staff_id:number}
export type Assignment = {programme_id:number;staff_id:number}
export const normalizeProgramme = (value:string) => value.trim().replace(/\s+/g,' ').toLocaleLowerCase()
export function previewHandshake(plans:Plan[],programmes:Programme[],participants:Link[],assignments:Assignment[]){
  const results=plans.map(plan=>{
    const matches=programmes.filter(pr=>normalizeProgramme(pr.name)===normalizeProgramme(plan.title))
    const participantIds=[...new Set(participants.filter(x=>x.plan_id===plan.id).map(x=>x.staff_id))]
    const matching=matches.length===1?matches[0]:null
    const assigned=new Set(assignments.filter(x=>x.programme_id===matching?.id).map(x=>x.staff_id))
    const missing=matching?participantIds.filter(id=>!assigned.has(id)):[]
    return {plan_id:plan.id,title:plan.title,status:plan.status,programme_id:matching?.id||null,
      match_status:matches.length===0?'new_programme':matches.length===1?'matched':'ambiguous',
      participants:participantIds.length,already_assigned:participantIds.length-missing.length,
      would_assign:missing.length,blocked_participants:matching?0:participantIds.length,staff_ids_to_assign:missing}
  })
  return {plans:results,summary:{
    plans:results.length,matched:results.filter(x=>x.match_status==='matched').length,
    new_programmes:results.filter(x=>x.match_status==='new_programme').length,
    ambiguous:results.filter(x=>x.match_status==='ambiguous').length,
    assignments_to_add:results.reduce((n,x)=>n+x.would_assign,0),
    blocked_participants:results.reduce((n,x)=>n+x.blocked_participants,0)
  }}
}
