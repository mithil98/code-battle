import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, runCode } from '../runner.js';

test('verdict maps Piston results', () => {
  assert.equal(verdict({ run: { stdout: '5\r\n', code: 0 } }, '5\n').ok, true);
  assert.equal(verdict({ run: { stdout: '1 2  \n3\n', code: 0 } }, '1 2\n3').ok, true);
  assert.equal(verdict({ run: { stdout: '6\n', code: 0 } }, '5').error, 'Wrong answer');
  assert.equal(verdict({ run: { stdout: '', code: null, signal: 'SIGKILL', status: 'TO' } }, '5').error, 'Time limit exceeded');
  assert.equal(verdict({ run: { stdout: '', stderr: 'boom', code: 1 } }, '5').error, 'Runtime error');
  assert.equal(verdict({ compile: { code: 1, stderr: 'expected ;' }, run: {} }, '5').error, 'Compilation error');
  assert.equal(verdict({ run: { stdout: 'x', code: null, signal: 'SIGKILL', status: 'OL' } }, '5').error, 'Output limit exceeded');
});

test('runCode rejects unknown languages and propagates runner outages', async () => {
  await assert.rejects(runCode('ruby', 'puts 1', [{ input: '', output: '' }]), /Unsupported/);
  process.env.PISTON_URL = 'http://127.0.0.1:9';
  await assert.rejects(runCode('python', 'print(1)', [{ input: '', output: '1' }]));
});

// Live check against a real Piston: PISTON_LIVE=http://localhost:2000 node --test test/runner.test.js
test('live Piston round trip', { skip: !process.env.PISTON_LIVE }, async () => {
  process.env.PISTON_URL = process.env.PISTON_LIVE;
  const tests = [{ input: '2 3', output: '5' }];
  const cases = {
    python: 'a, b = map(int, input().split())\nprint(a + b)',
    javascript: "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(' ').map(Number);\nconsole.log(a + b);",
    cpp: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}',
    java: 'import java.util.*;\npublic class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}',
  };
  for (const [lang, code] of Object.entries(cases)) {
    const res = await runCode(lang, code, tests);
    assert.equal(res.passed, 1, `${lang}: ${JSON.stringify(res.results)}`);
  }
  const loop = await runCode('python', 'while True: pass', tests);
  assert.equal(loop.results[0].error, 'Time limit exceeded');
});
