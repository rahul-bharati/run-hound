export type CommandHandler = (args: string[]) => Promise<number | void> | number | void;

export type CommandRegistry = ReadonlyMap<string, CommandHandler>;

export type DispatchFn = (args: string[]) => Promise<number | void>;
