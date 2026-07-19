#!/usr/bin/env python3
"""codexq:常駐 codex 生圖排程系統。

隨時 enqueue 生圖 job,daemon 單一序列(一次一張)跑 codex CLI,生完自動搬檔到指定路徑。
job 為 JSON 檔,FIFO 依檔名時間戳排序;目錄即狀態(pending → running → done/failed)。

用法:
  tools/codex_queue.py add --prompt "..." --out /abs/out.png [--ref /abs/ref.png] [--name 標籤] [--no-strip]
  tools/codex_queue.py add --prompt-file assets/prompts/foo.txt --out ...
  tools/codex_queue.py start    # 背景啟動 daemon(已在跑則不重複)
  tools/codex_queue.py stop     # 停 daemon(當前 job 跑完才停)
  tools/codex_queue.py status   # 佇列狀態 + 最近 log
  tools/codex_queue.py daemon   # 前景 daemon(start 內部用)

坑(繼承 gen-queue.sh):codex -i 是變長參數會吃掉 prompt,必須 --image=<file> 單 token;
codex 產圖一律落 ~/.codex/generated_images/<session id>/,要自己搬,不能信它「已存到指定路徑」。
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/yanchen/workspace/rpg-maker')
QDIR = ROOT / 'assets' / 'queue'
PENDING, RUNNING, DONE, FAILED = (QDIR / s for s in ('pending', 'running', 'done', 'failed'))
LOG = QDIR / 'queue.log'
PIDFILE = QDIR / 'daemon.pid'
CODEX_IMAGES = Path.home() / '.codex' / 'generated_images'


def log(msg: str) -> None:
    line = f"{datetime.now().strftime('%m-%d %H:%M:%S')} {msg}"
    with LOG.open('a') as f:
        f.write(line + '\n')
    print(line, flush=True)


def ensure_dirs() -> None:
    for d in (PENDING, RUNNING, DONE, FAILED):
        d.mkdir(parents=True, exist_ok=True)


def daemon_alive() -> int | None:
    if not PIDFILE.exists():
        return None
    try:
        pid = int(PIDFILE.read_text().strip())
        os.kill(pid, 0)
        return pid
    except (ValueError, ProcessLookupError, PermissionError):
        return None


def cmd_add(argv: list[str]) -> None:
    import argparse
    ap = argparse.ArgumentParser(prog='codexq add')
    ap.add_argument('--prompt')
    ap.add_argument('--prompt-file')
    ap.add_argument('--ref')
    ap.add_argument('--out', required=True)
    ap.add_argument('--name')
    ap.add_argument('--no-strip', action='store_true')
    a = ap.parse_args(argv)
    if not a.prompt and not a.prompt_file:
        sys.exit('add 需要 --prompt 或 --prompt-file')
    prompt = a.prompt or Path(a.prompt_file).read_text().strip()
    if a.ref and not Path(a.ref).is_file():
        sys.exit(f'ref 不存在: {a.ref}')
    name = a.name or Path(a.out).stem
    job = {
        'name': name,
        'prompt': prompt,
        'ref': str(Path(a.ref).resolve()) if a.ref else None,
        'out': str(Path(a.out).resolve()),
        'strip': not a.no_strip,
        'queued_at': datetime.now().isoformat(timespec='seconds'),
    }
    ensure_dirs()
    path = PENDING / f"{time.time_ns()}-{re.sub(r'[^A-Za-z0-9_-]', '_', name)}.json"
    path.write_text(json.dumps(job, ensure_ascii=False, indent=2))
    log(f'QUEUED {name} -> {job["out"]}')
    if not daemon_alive():
        print('(daemon 未在跑,記得 codexq start)')


def run_job(job_path: Path) -> None:
    job = json.loads(job_path.read_text())
    name = job['name']
    out = Path(job['out'])
    out.parent.mkdir(parents=True, exist_ok=True)
    clog = job_path.with_suffix('.codex.log')
    log(f'START {name}')
    cmd = ['codex', 'exec']
    if job.get('ref'):
        cmd.append(f"--image={job['ref']}")
    cmd.append(job['prompt'])
    t0 = time.time()
    with clog.open('w') as f:
        subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT,
                       timeout=600, check=False)
    text = clog.read_text(errors='replace')
    m = re.search(r'session id: ([0-9a-f-]+)', text)
    src = None
    if m:
        imgs = sorted((CODEX_IMAGES / m.group(1)).glob('*.png'),
                      key=lambda p: p.stat().st_mtime, reverse=True) if (CODEX_IMAGES / m.group(1)).is_dir() else []
        src = imgs[0] if imgs else None
    if src:
        out.write_bytes(src.read_bytes())
        if job.get('strip', True):
            subprocess.run(['python3', str(ROOT / 'tools' / 'strip-bg.py'), str(out)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        job['result'] = {'ok': True, 'src': str(src), 'seconds': round(time.time() - t0)}
        job_path.write_text(json.dumps(job, ensure_ascii=False, indent=2))
        job_path.rename(DONE / job_path.name)
        clog.rename(DONE / clog.name)
        log(f'DONE {name} ({job["result"]["seconds"]}s) -> {out}')
    else:
        job['result'] = {'ok': False, 'sid': m.group(1) if m else None,
                         'seconds': round(time.time() - t0)}
        job_path.write_text(json.dumps(job, ensure_ascii=False, indent=2))
        job_path.rename(FAILED / job_path.name)
        clog.rename(FAILED / clog.name)
        log(f'FAIL {name} (sid={job["result"]["sid"]}, no image) log={FAILED / clog.name}')


def cmd_daemon() -> None:
    ensure_dirs()
    if (pid := daemon_alive()) and pid != os.getpid():
        sys.exit(f'daemon 已在跑 (pid {pid})')
    PIDFILE.write_text(str(os.getpid()))
    log(f'DAEMON up (pid {os.getpid()})')
    try:
        while True:
            if (QDIR / 'stop').exists():
                (QDIR / 'stop').unlink()
                log('DAEMON stop requested, bye')
                return
            # 撿回上次沒跑完的 running(daemon 被殺留下的)
            jobs = sorted(RUNNING.glob('*.json')) or sorted(PENDING.glob('*.json'))
            if not jobs:
                time.sleep(3)
                continue
            j = jobs[0]
            if j.parent == PENDING:
                j = j.rename(RUNNING / j.name)
            try:
                run_job(j)
            except Exception as e:  # 單 job 掛掉不拖垮 daemon
                log(f'ERROR {j.name}: {e}')
                if j.exists():
                    j.rename(FAILED / j.name)
    finally:
        PIDFILE.unlink(missing_ok=True)


def cmd_start() -> None:
    ensure_dirs()
    if pid := daemon_alive():
        print(f'daemon 已在跑 (pid {pid})')
        return
    subprocess.Popen(['nohup', 'python3', str(Path(__file__).resolve()), 'daemon'],
                     stdout=(QDIR / 'daemon.out').open('a'), stderr=subprocess.STDOUT,
                     start_new_session=True)
    time.sleep(1)
    print(f'daemon 啟動 (pid {daemon_alive()})' if daemon_alive() else 'daemon 啟動失敗,看 daemon.out')


def cmd_stop() -> None:
    if not daemon_alive():
        print('daemon 沒在跑')
        return
    (QDIR / 'stop').touch()
    print('已送停止訊號(當前 job 跑完才停)')


def cmd_status() -> None:
    ensure_dirs()
    pid = daemon_alive()
    print(f"daemon: {'跑著 (pid %d)' % pid if pid else '沒在跑'}")
    for label, d in (('pending', PENDING), ('running', RUNNING), ('done', DONE), ('failed', FAILED)):
        names = [json.loads(p.read_text()).get('name', p.stem) for p in sorted(d.glob('*.json'))]
        print(f'{label:8} {len(names):3}  {" ".join(names[-8:])}')
    if LOG.exists():
        print('--- 最近 log ---')
        print('\n'.join(LOG.read_text().splitlines()[-8:]))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, rest = sys.argv[1], sys.argv[2:]
    if cmd == 'add':
        cmd_add(rest)
    elif cmd == 'daemon':
        cmd_daemon()
    elif cmd == 'start':
        cmd_start()
    elif cmd == 'stop':
        cmd_stop()
    elif cmd == 'status':
        cmd_status()
    else:
        sys.exit(f'未知子指令: {cmd}\n{__doc__}')
