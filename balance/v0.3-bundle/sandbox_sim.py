"""Rule Sabotage V0.3 exploratory SELF-CONTAINED simulator.

NOT THE REPOSITORY'S AUTHORITATIVE ENGINE.  For hypothesis screening only.
No Kane CLI integration. No fabricated Kane judgments.
Uses the public rules description: 7x7, 3 pieces, alternate turns,
entry-triggered effects, consumption, forced cap of 4, 60-turn limit.
Deliberate simplifications: no stacks as a multi-piece action, no public/private
mine distinction, no Kane referee, no proposed compound reset effects.
"""
import argparse
import copy
import csv
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
from statistics import mean

W,H=7,7
FAMILIES=['shove_back_2','shove_east_2','shove_west_2','freeze','home','teleport','shield','haste']
DEFAULTS={
 'shove_back_2':-2.0,'shove_east_2':0.0,'shove_west_2':0.0,
 'freeze':-2.2,'home':-3.8,'teleport':-0.8,'shield':1.4,'haste':1.8,
}
DIRECTIONS=[(1,0),(-1,0),(0,1),(0,-1)]

def rng(s):
  x=s['rng'] or 0x9e3779b9
  x^=(x<<13)&0xffffffff; x^=x>>17; x^=(x<<5)&0xffffffff
  s['rng']=x&0xffffffff or 0x9e3779b9
  return s['rng']

def pieces(s,side):
 return [q for q in s['pieces'] if q['side']==side and not q['scored']]

def goal(side): return 6 if side==0 else 0

def state(seed):
 s={'seed':seed,'rng':seed or 1,'turn':0,'current':0,'actions':0,'bonus':[0,0],
    'pieces':[{'id':f'{side}{row}','side':side,'x':0 if side==0 else 6,'y':row,'home_x':0 if side==0 else 6,'home_y':row,'scored':False,'freeze':0,'shield':False} for side in (0,1) for row in (1,3,5)],
    'traps':{},'ntraps':0,'events':Counter(),'effect_stats':{},'winner':None}
 s['current']=rng(s)%2
 return s

def key(x,y): return f'{x},{y}'

def inboard(x,y): return 0<=x<7 and 0<=y<7

def player_at(s,x,y): return [q for q in s['pieces'] if not q['scored'] and (q['x'],q['y'])==(x,y)]

def effect_utility(fam,side,w):
 if fam=='shove_east_2': return w.get('shove_back_2',-2.0)*(-1 if side==0 else 1)
 if fam=='shove_west_2': return w.get('shove_back_2',-2.0)*(1 if side==0 else -1)
 return w.get(fam,0.0)

def proximity(s,side,x,y):
 acc=0.0
 for q in pieces(s,side):
  # Penalize squares already passed by that side
  if (goal(side)-q['x'])*(goal(side)-x)<0: continue
  lateral=abs(y-q['y']); dist=abs(x-q['x'])
  acc+=1/(1+0.8*lateral+0.65*dist)
 return acc

def put_trap(s,side,fam,cells):
 for xy in cells:
  if xy in s['traps']: continue
  s['traps'][xy]={'family':fam,'installer':side}
  s['ntraps']+=1
  s['events']['placed']+=1
  s['events']['placed_'+fam]+=1

def place(s,side,w,ban_radius=0):
 # Position is observed before movement; score each candidate only by
 # estimated activation exposure, not by owner-biased trigger semantics.
 eligible=[]
 for x in range(W):
  for y in range(H):
   xy=key(x,y)
   if xy in s['traps'] or player_at(s,x,y): continue
   if ban_radius and any(max(abs(x-q['x']),abs(y-q['y']))<=ban_radius for q in s['pieces'] if not q['scored']): continue
   eligible.append((x,y,xy))
 if not eligible: return
 best=None
 for fam in FAMILIES:
  ranked=[]
  for x,y,xy in eligible:
   risk_other=proximity(s,1-side,x,y)
   risk_self=proximity(s,side,x,y)
   # Positive for hurting opponent, negative for hurting self; a bonus trap
   # benefits the player who steps on it, not the installer.
   val=(-effect_utility(fam,1-side,w)*risk_other + effect_utility(fam,side,w)*risk_self)
   ranked.append((val,xy))
  ranked.sort(key=lambda a:(-a[0],a[1]))
  subset=[xy for val,xy in ranked[:3] if val>0.18]
  if subset:
   total=sum(v for v,xy in ranked[:len(subset)])-0.20*len(subset)
   item=(total,fam,subset)
   if best is None or item[0]>best[0]: best=item
 if best and best[0]>0.2: put_trap(s,side,best[1],best[2]);

def score_if_goal(s,q):
 if q['x']==goal(q['side']) and not q['scored']:
  q['scored']=True; q['freeze']=0; q['shield']=False;s['events']['score']+=1

def land(s,q,move_dir,depth=1):
 if q['scored']:return
 x,y=q['x'],q['y']
 # Capture.
 for opp in player_at(s,x,y):
  if opp['side']!=q['side']:
   opp['x']=opp['home_x'];opp['y']=opp['home_y'];opp['freeze']=0;opp['shield']=False
   s['events']['capture']+=1
 xy=key(x,y)
 trap=s['traps'].get(xy)
 if trap and depth<=4:
  del s['traps'][xy]
  s['events']['trigger']+=1
  fam=trap['family'];s['events']['trigger_'+fam]+=1
  s['events']['self_trigger' if trap['installer']==q['side'] else 'opponent_trigger']+=1
  if q['shield']:
   q['shield']=False;s['events']['shield_absorbed']+=1;score_if_goal(s,q);return
  if fam in ('shove_back_2','shove_east_2','shove_west_2'):
   d=(-move_dir[0],-move_dir[1]) if fam=='shove_back_2' else ((1,0) if fam=='shove_east_2' else (-1,0))
   for _ in range(2):
    if not inboard(q['x']+d[0],q['y']+d[1]):break
    q['x']+=d[0];q['y']+=d[1]
   if (q['x'],q['y'])!=(x,y):return land(s,q,d,depth+1)
  elif fam=='home':
   q['x']=q['home_x'];q['y']=q['home_y']
  elif fam=='freeze':q['freeze']=2
  elif fam=='shield':q['shield']=True
  elif fam=='haste':s['actions']+=1
  elif fam=='teleport':
   candidates=[(xx,yy) for xx in range(1,6) for yy in range(7) if key(xx,yy) not in s['traps'] and not player_at(s,xx,yy)]
   if candidates:q['x'],q['y']=candidates[rng(s)%len(candidates)]
 elif trap and depth>4: s['events']['chain_cap']+=1
 score_if_goal(s,q)

def potential(s,side):
 own=pieces(s,side);other=pieces(s,1-side)
 def pot(q):
  return 6-abs(goal(q['side'])-q['x'])-0.8*(q['freeze']>0)+0.5*q['shield']
 return 11*(3-len(own))-11*(3-len(other))+sum(pot(q) for q in own)-sum(pot(q) for q in other)

def moves(s,side):
 while s['actions']>0 and s['winner'] is None:
  options=[]; baseline=potential(s,side)
  for q in pieces(s,side):
   if q['freeze']:continue
   for dx,dy in DIRECTIONS:
    x,y=q['x']+dx,q['y']+dy
    if not inboard(x,y):continue
    t=copy.deepcopy(s)
    z=next(z for z in t['pieces'] if z['id']==q['id']);z['x'],z['y']=x,y
    t['actions']-=1;land(t,z,(dx,dy))
    score=potential(t,side)-baseline
    # Guard against indecisive oscillation with a mild preference for goal
    # progress; make tie-breaking deterministic across mirrored runs.
    score+=.02*dx*(1 if side==0 else -1)
    options.append((score,q['id'],dx,dy,t))
  if not options:break
  options.sort(key=lambda x:(-x[0],x[1],x[2],x[3]))
  _,_,_,_,chosen=options[0]
  s.update(chosen)
  s['events']['move']+=1
  if len(pieces(s,side))==0:s['winner']=side

def run(seed,weights_a,weights_b,ban_radius=0):
 s=state(seed)
 first=s['current']
 for turn in range(60):
  s['turn']=turn+1;side=s['current']
  w=weights_a if side==0 else weights_b
  place(s,side,w,ban_radius)
  s['actions']=len(pieces(s,side))+s['bonus'][side];s['bonus'][side]=0
  # frozen counts progress after own turn
  moves(s,side)
  if s['winner'] is not None:break
  for q in pieces(s,side):q['freeze']=max(0,q['freeze']-1)
  s['current']=1-side
 if s['winner'] is None:
  scored=[sum(q['scored'] for q in s['pieces'] if q['side']==side) for side in (0,1)]
  if scored[0]!=scored[1]:s['winner']=0 if scored[0]>scored[1] else 1
  else:
   dist=[sum(abs(goal(side)-q['x']) for q in pieces(s,side)) for side in (0,1)]
   s['winner']=0 if dist[0]<dist[1] else 1 if dist[1]<dist[0] else 'draw'
 return {'seed':seed,'winner':s['winner'],'first':first,'turns':s['turn'],**dict(s['events'])}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--games',type=int,default=80);ap.add_argument('--seed',type=int,default=41000);ap.add_argument('--out',default='results');ap.add_argument('--ban-radius',type=int,default=0);arg=ap.parse_args()
 out=Path(arg.out);out.mkdir(parents=True,exist_ok=True)
 baseline=json.loads(json.dumps(DEFAULTS));candidate={**baseline,'freeze':-1.7,'home':-3.1,'haste':2.2}
 variants={'baseline':baseline,'candidate_heuristic_not_kane':candidate}
 (out/'weights.json').write_text(json.dumps(variants,indent=2,ensure_ascii=False)+'\n')
 data=[]
 # mirrored matches: candidate plays side0 then side1 with identical seeds
 for vname,wa,wb,which_candidate in [
  ('baseline_selfplay',baseline,baseline,None),
  ('candidate_vs_baseline_A',candidate,baseline,0),
  ('candidate_vs_baseline_B',baseline,candidate,1),
 ]:
  for i in range(arg.games):
   seed=arg.seed+i
   r=run(seed,wa,wb,arg.ban_radius)
   r.update({'arm':vname,'candidate_side':which_candidate,'candidate_win':int(r['winner']==which_candidate) if which_candidate is not None else None})
   data.append(r)
 with (out/'matches.csv').open('w',newline='') as f:
  keys=['seed','arm','winner','candidate_side','candidate_win','turns','placed','trigger','self_trigger','opponent_trigger','capture','score','move','chain_cap']
  w=csv.DictWriter(f,fieldnames=keys,extrasaction='ignore');w.writeheader();w.writerows(data)
 summary={}
 for arm in sorted(set(r['arm'] for r in data)):
  rows=[r for r in data if r['arm']==arm]
  w=Counter(str(r['winner']) for r in rows)
  summary[arm]={'games':len(rows),'wins':dict(w),'mean_turns':round(mean(r['turns'] for r in rows),2),
   'mean_triggers':round(mean(r.get('trigger',0) for r in rows),2),
   'mean_self_triggers':round(mean(r.get('self_trigger',0) for r in rows),2),
   'mean_placements':round(mean(r.get('placed',0) for r in rows),2),
   'candidate_win_rate':round(mean(r['candidate_win'] for r in rows),3) if rows[0]['candidate_win'] is not None else None,
   'first_player_win_rate':round(mean(r['winner']==r['first'] for r in rows),3)}
 (out/'summary.json').write_text(json.dumps({'status':'REJECTED_AS_BALANCE_EVIDENCE' if (abs(summary['baseline_selfplay']['wins'].get('0',0)/arg.games-.5)>.2 or abs(summary['baseline_selfplay']['first_player_win_rate']-.5)>.2) else 'EXPLORATORY_ONLY', 'sanity_gate':'FAIL' if (abs(summary['baseline_selfplay']['wins'].get('0',0)/arg.games-.5)>.2 or abs(summary['baseline_selfplay']['first_player_win_rate']-.5)>.2) else 'PROVISIONAL_PASS', 'kane_executed':False,'ban_radius':arg.ban_radius,'seed_start':arg.seed,'summary':summary},indent=2)+'\n')
 print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
