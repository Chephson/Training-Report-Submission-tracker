import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const app=readFileSync('public/static/app.js','utf8')
const shell=readFileSync('src/index.tsx','utf8')
test('application and admin workspace are renamed',()=>{
 assert.match(shell,/HCD_HCOT Solution/)
 assert.match(app,/title: 'Admin Controls'/)
 assert.match(app,/HCD_HCOT Solution/)
})
test('administrative tools are hidden from main navigation and linked inside Admin Controls',()=>{
 const nav=shell.slice(shell.indexOf('<nav class="nav"'),shell.indexOf('</nav>'))
 for(const view of ['roster','setup','settings'])assert.doesNotMatch(nav,new RegExp('data-view="'+view+'"'))
 const render=app.slice(app.indexOf('async function renderHCOT(el)'),app.indexOf('async function renderRoster(el)'))
 for(const view of ['roster','setup','settings'])assert.ok(render.includes('href="#/'+view+'"'),view)
 assert.match(app,/Back to Admin Controls/)
})
test('supervisor access remains restricted to supervisor gateway',()=>{
 assert.match(app,/state.hcotRole!=='admin' && view!=='supervisors'/)
 assert.match(app,/const isAdmin=session.role==='admin'/)
})
