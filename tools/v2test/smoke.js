const L = require('./lib');
(async () => {
  await L.start('/home/claude/BaepApp/web');
  const { p } = await L.ctx('smoke');
  await p.goto(L.ROOT + '/index.html'); await L.sleep(1500);
  console.log(await L.st(p));
  await L.A(p, 'spl-go'); await L.shot(p, 'smoke-join');
  console.log(await L.st(p), L.errors, L.BE.B.log.slice(0, 10));
  await L.stop();
})().catch(e => { console.error(e); L.stop(); });
