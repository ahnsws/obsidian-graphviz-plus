import { App, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { ENGINES, isEngine, type Engine } from "./core/dot";

export interface GraphvizPlusSettings {
  /** Vault path or note name of the preamble note; empty = no preamble. */
  preamblePath: string;
  /** Engine used by a block that has no outer `layout=` attribute. */
  defaultEngine: Engine;
}

export const DEFAULT_SETTINGS: GraphvizPlusSettings = {
  preamblePath: "",
  defaultEngine: "dot",
};

interface SettingsHost extends Plugin {
  settings: GraphvizPlusSettings;
  readonly fallbackEngine: Engine;
  resolvePreambleFile(path: string): TFile | null;
  saveSettings(): Promise<void>;
}

export class GraphvizPlusSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: SettingsHost,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const setting = new Setting(containerEl)
      .setName("Preamble note")
      .setDesc(
        "The plugin inserts the text of this note at the top of every dot block, " +
          "so rankdir, node[…] and edge[…] defaults are written once instead of " +
          "in every block. The note holds raw DOT, or a fenced dot block. Leave " +
          "it empty to insert nothing.",
      );
    const status = containerEl.createDiv({
      cls: "graphviz-plus-setting-status",
    });

    const showStatus = (path: string) => {
      const p = path.trim();
      const file = p && this.plugin.resolvePreambleFile(p);
      if (!p) status.setText("No preamble note set.");
      else if (file) status.setText(`Reads ${file.path}`);
      else
        status.setText(
          `No note found at "${p}". Blocks render without a preamble.`,
        );
    };

    setting.addText((text) =>
      text
        .setPlaceholder("graphviz-preamble")
        .setValue(this.plugin.settings.preamblePath)
        .onChange(async (value) => {
          this.plugin.settings.preamblePath = value;
          await this.plugin.saveSettings();
          showStatus(value);
        }),
    );
    showStatus(this.plugin.settings.preamblePath);

    new Setting(containerEl)
      .setName("Default layout engine")
      .setDesc("Used by a block that sets no layout= attribute.")
      .addDropdown((dropdown) => {
        ENGINES.forEach((engine) => dropdown.addOption(engine, engine));
        dropdown.setValue(this.plugin.fallbackEngine).onChange(async (value) => {
          if (!isEngine(value)) return;
          this.plugin.settings.defaultEngine = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
