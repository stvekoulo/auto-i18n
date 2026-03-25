import chalk from 'chalk';

export const logger = {
  success(msg: string): void {
    console.log(chalk.green(`  ✓ ${msg}`));
  },

  error(msg: string): void {
    console.error(chalk.red(`  ✗ ${msg}`));
  },

  warn(msg: string): void {
    console.log(chalk.yellow(`  ⚠ ${msg}`));
  },

  info(msg: string): void {
    console.log(chalk.cyan(`  ℹ ${msg}`));
  },

  step(msg: string): void {
    console.log(chalk.bold(`\n▸ ${msg}`));
  },

  dim(msg: string): void {
    console.log(chalk.dim(`  ${msg}`));
  },

  blank(): void {
    console.log();
  },
};
