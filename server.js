import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import crypto from 'crypto';

dotenv.config();
const { Pool } = pg;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const VERSION = process.env.APP_VERSION || '2.1.0';
const SERVICE = 'qrv-api';
const DATABASE_URL = process.env.DATABASE_URL || '';
const DATA_BACKEND = process.env.QRV_DATA_BACKEND || 'postgresql';
const PLATFORM_ORIGIN = (process.env.QRV_PLATFORM_ORIGIN || 'https://qrv.network').replace(/\/$/, '');
const WRITE_KEY = process.env.QRV_API_KEY || process.env.QRV_PLATFORM_API_KEY || process.env.REGISTRY_API_KEY || '';
const PUBLIC_RATE_LIMIT = Number(process.env.PUBLIC_RATE_LIMIT || 240);
const PUBLIC_RATE_WINDOW_MS = Number(process.env.PUBLIC_RATE_WINDOW_MS || 60000);
const STARTED_AT = new Date().toISOString();
const allowedOrigins = new Set((process.env.CORS_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || PLATFORM_ORIGIN).split(',').map(v=>v.trim()).filter(Boolean));

app.use(cors({origin(origin,cb){if(!origin||allowedOrigins.has(origin)) return cb(null,true); return cb(new Error('CORS origin denied'));},methods:['GET','POST','OPTIONS'],allowedHeaders:['content-type','authorization','x-api-key','x-request-id']}));

const pool = DATABASE_URL ? new Pool({connectionString:DATABASE_URL,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false},max:Number(process.env.DATABASE_POOL_MAX||20),connectionTimeoutMillis:Number(process.env.PG_CONNECTION_TIMEOUT_MS||5000),idleTimeoutMillis:Number(process.env.PG_IDLE_TIMEOUT_MS||10000)}) : null;
if(pool) pool.on('error',e=>console.error('PostgreSQL pool error:',e.message));

const now=()=>new Date().toISOString();
const requestId=req=>String(req.headers['x-request-id']||crypto.randomUUID());
function sendError(res,status,code,message,details){return res.status(status).json({ok:false,service:SERVICE,error:{code,message,...(details?{details}:{})},timestamp:now()});}
function stableStringify(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stableStringify).join(',')}]`;const keys=Object.keys(v).sort();return `{${keys.map(k=>`${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;}
const hashPayload=p=>crypto.createHash('sha256').update(stableStringify(p)).digest('hex');
function typeCode(t){const n=String(t||'GEN').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');return {CERTIFICATE:'CERT',MEMBERSHIP:'ID',IDENTITY:'ID',PRODUCT:'PROD',DOCUMENT:'DOC',PROPERTY:'PROP',ASSET:'ASSET'}[n]||n.slice(0,8)||'GEN';}
const generateQrvid=t=>`QRV-${typeCode(t)}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
function normalizeVerificationState(row){if(!row)return'NOT_FOUND';const s=String(row.status||'').toLowerCase();if(s==='revoked')return'REVOKED';if(s==='expired')return'EXPIRED';if(row.expiration_date){const d=new Date(`${String(row.expiration_date).slice(0,10)}T23:59:59.999Z`);if(!Number.isNaN(d.getTime())&&d.getTime()<Date.now())return'EXPIRED';}return ['verified','valid','active'].includes(s)?'VERIFIED':'NOT_FOUND';}
function publicRecord(row){const state=normalizeVerificationState(row);return{qrvid:row.qrvid,state,status:state,verified:state==='VERIFIED',recordType:row.record_type,issuer:row.issuer,owner:row.owner||row.recipient_name||null,recipient:row.recipient_name||row.owner||null,title:row.certificate_title||null,issueDate:row.issue_date||null,expirationDate:row.expiration_date||null,hash:row.hash,createdAt:row.created_at,updatedAt:row.updated_at,canonicalUrl:`${PLATFORM_ORIGIN}/verify/${encodeURIComponent(row.qrvid)}`,integrity:{hashAlgorithm:'SHA-256',hashPresent:Boolean(row.hash),signatureValid:null,note:'Ed25519 issuer signature validation is not yet enabled.'}};}
function requireDatabase(_req,res,next){if(!pool)return sendError(res,503,'DATABASE_NOT_CONFIGURED','DATABASE_URL is required for this operation');next();}
function requireWriteAuth(req,res,next){if(!WRITE_KEY)return sendError(res,503,'WRITE_AUTH_NOT_CONFIGURED','QRV_API_KEY must be configured before protected operations are enabled');const auth=String(req.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7):String(req.headers['x-api-key']||'');const a=Buffer.from(WRITE_KEY),b=Buffer.from(token);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return sendError(res,401,'UNAUTHORIZED','Valid API authorization is required');next();}
const limiter=new Map();function publicRateLimit(req,res,next){const key=String(req.headers['x-forwarded-for']||req.ip||'unknown').split(',')[0].trim(),t=Date.now(),b=limiter.get(key)||{started:t,count:0};if(t-b.started>=PUBLIC_RATE_WINDOW_MS){b.started=t;b.count=0;}b.count++;limiter.set(key,b);if(b.count>PUBLIC_RATE_LIMIT)return sendError(res,429,'RATE_LIMITED','Too many verification requests');next();}
async function audit(client,qrvid,eventType,metadata={}){try{await client.query('INSERT INTO qr_audit_log (qrvid, event_type, metadata) VALUES ($1,$2,$3)',[qrvid,eventType,metadata]);}catch(e){console.error('Audit write failed:',e.message);}}
async function findRecord(qrvid){const r=await pool.query(`SELECT o.*,c.recipient_name,c.certificate_title,c.issue_date,c.expiration_date FROM qr_objects o LEFT JOIN qr_certificates c ON c.qrvid=o.qrvid WHERE o.qrvid=$1 LIMIT 1`,[qrvid]);return r.rows[0]||null;}

app.get('/',(_req,res)=>res.json({ok:true,service:SERVICE,version:VERSION,architecture:'two-node-consolidated',platform:PLATFORM_ORIGIN,role:'canonical-api-and-registry-node',dataBackend:DATA_BACKEND}));
app.get('/healthz',(_req,res)=>res.json({ok:true,status:'ok',service:SERVICE,version:VERSION,timestamp:now()}));
app.get('/health',(_req,res)=>res.json({ok:true,status:'ok',service:SERVICE,version:VERSION,timestamp:now()}));
app.get('/version',(_req,res)=>res.json({ok:true,service:SERVICE,version:VERSION,startedAt:STARTED_AT,architecture:'two-node-consolidated',dataBackend:DATA_BACKEND,ed25519:'not-enabled'}));
async function readiness(_req,res){if(!pool)return res.status(503).json({ok:false,ready:false,service:SERVICE,dataBackend:DATA_BACKEND,database:'not_configured',timestamp:now()});try{await pool.query('SELECT 1 FROM qr_objects LIMIT 1');return res.json({ok:true,ready:true,service:SERVICE,dataBackend:DATA_BACKEND,database:'connected',timestamp:now()});}catch(e){return res.status(503).json({ok:false,ready:false,service:SERVICE,dataBackend:DATA_BACKEND,database:'error',timestamp:now()});}}
app.get('/readyz',readiness);app.get('/ready',readiness);
app.get('/api/v1/status',async(_req,res)=>{if(!pool)return res.status(503).json({ok:false,status:'NOT_READY',service:SERVICE,dataBackend:DATA_BACKEND,timestamp:now()});try{await pool.query('SELECT 1');return res.json({ok:true,status:'OPERATIONAL',service:SERVICE,dataBackend:DATA_BACKEND,version:VERSION,timestamp:now()});}catch{return res.status(503).json({ok:false,status:'NOT_READY',service:SERVICE,dataBackend:DATA_BACKEND,timestamp:now()});}});

app.get('/api/v1/verify/:qrvid',publicRateLimit,requireDatabase,async(req,res)=>{const qrvid=String(req.params.qrvid||'').trim().toUpperCase();if(!/^QRV-[A-Z0-9][A-Z0-9-]{2,127}$/.test(qrvid))return sendError(res,422,'INVALID_QRVID','QRVID format is invalid');try{const row=await findRecord(qrvid);if(!row)return res.status(404).json({ok:false,verified:false,state:'NOT_FOUND',status:'NOT_FOUND',qrvid,canonicalUrl:`${PLATFORM_ORIGIN}/verify/${encodeURIComponent(qrvid)}`,timestamp:now()});const record=publicRecord(row);await audit(pool,qrvid,'VERIFY',{state:record.state,requestId:requestId(req)});return res.json({ok:record.state==='VERIFIED',...record,verifiedAt:now()});}catch(e){console.error('Verify failed:',e.message);return sendError(res,500,'VERIFY_FAILED','Verification request failed');}});
app.get('/api/v1/records/:qrvid',publicRateLimit,requireDatabase,async(req,res)=>{const qrvid=String(req.params.qrvid||'').trim().toUpperCase();try{const row=await findRecord(qrvid);if(!row)return res.status(404).json({ok:false,state:'NOT_FOUND',qrvid,timestamp:now()});return res.json({ok:true,record:publicRecord(row),timestamp:now()});}catch{return sendError(res,500,'LOOKUP_FAILED','Registry lookup failed');}});
app.post('/api/v1/records',requireDatabase,requireWriteAuth,async(req,res)=>{const recordType=String(req.body?.recordType||req.body?.type||'').trim().toLowerCase(),issuer=String(req.body?.issuer||'').trim(),owner=String(req.body?.owner||req.body?.recipient||'').trim()||null,title=String(req.body?.title||req.body?.certificateTitle||'').trim()||null,issueDate=req.body?.issueDate||new Date().toISOString().slice(0,10),expirationDate=req.body?.expirationDate||null,metadata=req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:{};if(!recordType||!issuer)return sendError(res,422,'INVALID_REQUEST','recordType and issuer are required');if(recordType==='certificate'&&(!owner||!title))return sendError(res,422,'INVALID_CERTIFICATE','recipient/owner and title are required for certificate records');const qrvid=generateQrvid(recordType),hash=hashPayload({qrvid,recordType,issuer,owner,title,issueDate,expirationDate,metadata}),client=await pool.connect();try{await client.query('BEGIN');await client.query(`INSERT INTO qr_objects(qrvid,record_type,issuer,owner,hash,status) VALUES($1,$2,$3,$4,$5,'verified')`,[qrvid,recordType,issuer,owner,hash]);await client.query(`INSERT INTO qr_hash_registry(qrvid,hash,algorithm) VALUES($1,$2,'sha256')`,[qrvid,hash]);if(recordType==='certificate')await client.query(`INSERT INTO qr_certificates(qrvid,recipient_name,certificate_title,issuer_name,issue_date,expiration_date,status,metadata) VALUES($1,$2,$3,$4,$5,$6,'verified',$7)`,[qrvid,owner,title,issuer,issueDate,expirationDate,metadata]);await audit(client,qrvid,'CREATE',{issuer,recordType,owner,requestId:requestId(req)});await client.query('COMMIT');const row=await findRecord(qrvid);return res.status(201).json({ok:true,state:'VERIFIED',qrvid,record:publicRecord(row),verifyUrl:`${PLATFORM_ORIGIN}/verify/${encodeURIComponent(qrvid)}`});}catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Create failed:',e.message);return sendError(res,500,'CREATE_FAILED','Registry record creation failed');}finally{client.release();}});
app.post('/api/v1/records/:qrvid/revoke',requireDatabase,requireWriteAuth,async(req,res)=>{const qrvid=String(req.params.qrvid||'').trim().toUpperCase(),reason=String(req.body?.reason||'').trim()||null,client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`UPDATE qr_objects SET status='revoked',updated_at=NOW(),revoked_at=NOW(),revocation_reason=$2 WHERE qrvid=$1 RETURNING *`,[qrvid,reason]);if(!r.rows.length){await client.query('ROLLBACK');return res.status(404).json({ok:false,state:'NOT_FOUND',qrvid,timestamp:now()});}await client.query(`UPDATE qr_certificates SET status='revoked',updated_at=NOW() WHERE qrvid=$1`,[qrvid]);await audit(client,qrvid,'REVOKE',{reason,requestId:requestId(req)});await client.query('COMMIT');const row=await findRecord(qrvid);return res.json({ok:true,state:'REVOKED',qrvid,record:publicRecord(row),timestamp:now()});}catch(e){await client.query('ROLLBACK').catch(()=>{});return sendError(res,500,'REVOKE_FAILED','Registry revocation failed');}finally{client.release();}});
app.get('/api/v1/records',requireDatabase,requireWriteAuth,async(req,res)=>{const limit=Math.min(Math.max(Number(req.query.limit||50),1),250);try{const r=await pool.query(`SELECT o.*,c.recipient_name,c.certificate_title,c.issue_date,c.expiration_date FROM qr_objects o LEFT JOIN qr_certificates c ON c.qrvid=o.qrvid ORDER BY o.created_at DESC LIMIT $1`,[limit]);return res.json({ok:true,records:r.rows.map(publicRecord),count:r.rows.length,timestamp:now()});}catch{return sendError(res,500,'LIST_FAILED','Unable to list registry records');}});
app.get('/api/v1/audit/:qrvid',requireDatabase,requireWriteAuth,async(req,res)=>{const qrvid=String(req.params.qrvid||'').trim().toUpperCase();try{const r=await pool.query('SELECT event_type,metadata,created_at FROM qr_audit_log WHERE qrvid=$1 ORDER BY created_at DESC LIMIT 250',[qrvid]);return res.json({ok:true,qrvid,events:r.rows,timestamp:now()});}catch{return sendError(res,500,'AUDIT_FAILED','Unable to load audit history');}});

app.use((err,_req,res,_next)=>{if(err?.message==='CORS origin denied')return sendError(res,403,'CORS_DENIED','Origin is not allowed');console.error('Unhandled API error:',err);return sendError(res,500,'INTERNAL_ERROR','Internal API error');});
app.use((_req,res)=>sendError(res,404,'NOT_FOUND','API route not found'));

const server=app.listen(PORT,()=>console.log(`QR-V API ${VERSION} listening on ${PORT}`));
function shutdown(signal){console.log(`${signal}: shutting down`);server.close(async()=>{if(pool)await pool.end().catch(()=>{});process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
