/** Minimal host doubles; production imports still use Obsidian itself. */
export class Plugin {
  processor!: (source: string, el: HTMLElement, ctx: unknown) => void;
  commands: Array<{ id: string; callback: () => void }> = [];
  saved: unknown = null;
  constructor(
    public app: unknown,
    public manifest: unknown,
  ) {}
  async loadData() {
    return this.saved;
  }
  async saveData(data: unknown) {
    this.saved = data;
  }
  registerMarkdownCodeBlockProcessor(
    _language: string,
    handler: typeof this.processor,
  ) {
    this.processor = handler;
  }
  addCommand(command: { id: string; callback: () => void }) {
    this.commands.push(command);
  }
  addSettingTab() {}
}
export class MarkdownRenderChild {
  constructor(public containerEl: HTMLElement) {}
  onload() {}
  onunload() {}
}
export class PluginSettingTab {
  constructor(..._args: unknown[]) {}
}
export class Setting {}
export class TFile {
  constructor(public path: string) {}
}
export const normalizePath = (path: string) => path.replace(/\\/g, "/");
