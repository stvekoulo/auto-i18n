declare module 'inquirer' {
  interface Question {
    type: string;
    name: string;
    message: string;
    default?: unknown;
    validate?: (input: string) => boolean | string;
    mask?: string;
    choices?: unknown[];
  }

  interface Inquirer {
    prompt<T = Record<string, unknown>>(questions: Question[]): Promise<T>;
  }

  const inquirer: Inquirer;
  export default inquirer;
}
