export type AccessConfig={HCOT_ACCESS_TEAM_DOMAIN?:string;HCOT_ACCESS_AUD?:string}
export type AccessIdentity={email:string;subject:string}
const decoder=new TextDecoder()
function decodeBase64Url(value:string):Uint8Array{
  const b64=value.replace(/-/g,'+').replace(/_/g,'/')
  const binary=atob(b64.padEnd(Math.ceil(b64.length/4)*4,'='))
  return Uint8Array.from(binary,c=>c.charCodeAt(0))
}
export async function verifyAccessJwt(request:Request,env:AccessConfig):Promise<AccessIdentity|null>{
  const domain=env.HCOT_ACCESS_TEAM_DOMAIN?.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'')
  const audience=env.HCOT_ACCESS_AUD?.trim()
  if(!domain||!audience||!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain))return null
  const token=request.headers.get('cf-access-jwt-assertion')
  if(!token||token.length>12000)return null
  const parts=token.split('.')
  if(parts.length!==3)return null
  try{
    const header=JSON.parse(decoder.decode(decodeBase64Url(parts[0])))
    const payload=JSON.parse(decoder.decode(decodeBase64Url(parts[1])))
    const now=Math.floor(Date.now()/1000)
    if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||
      payload.iss!==`https://${domain}`||!Array.isArray(payload.aud)||!payload.aud.includes(audience)||
      typeof payload.exp!=='number'||payload.exp<=now||
      typeof payload.nbf==='number'&&payload.nbf>now||
      typeof payload.iat==='number'&&payload.iat>now+60||
      typeof payload.sub!=='string'||!payload.sub||
      typeof payload.email!=='string'||!payload.email.includes('@'))return null
    const response=await fetch(`https://${domain}/cdn-cgi/access/certs`,{signal:AbortSignal.timeout(4000)})
    if(!response.ok)return null
    const keys=await response.json() as {keys?:Array<JsonWebKey&{kid?:string}>}
    const jwk=keys.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256')
    if(!jwk)return null
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])
    const verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodeBase64Url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]))
    return verified?{email:payload.email.toLowerCase(),subject:payload.sub}:null
  }catch{return null}
}
