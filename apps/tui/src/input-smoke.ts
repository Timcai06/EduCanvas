/* 输入框 pty 冒烟脚本：读一行并回显。仅供本地/CI 冒烟，不进入产品命令。 */
import process from 'node:process';
import { InputBox } from './input-box';
import { createTheme, detectThemeEnvironment } from './theme';

const theme = createTheme(detectThemeEnvironment(process.stdout, process.env));
const box = new InputBox(theme, process.stdin, process.stdout);
const line = await box.read({
  placeholder: '输入问题，/ 呼出命令',
  statusLine: '冒烟测试 · ● 已连接',
});
process.stdout.write(`RESULT=${line === null ? '<quit>' : JSON.stringify(line)}\n`);
process.exit(0);
