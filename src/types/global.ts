declare global {
  interface Window {
    __mindzj_hotkey_capturing: boolean;
    __mindzj_flush_workspace: ((...args: any[]) => any) | undefined | null;
    __mindzj_switch_open_tab: ((...args: any[]) => any) | undefined | null;
    __mindzj_icons: Record<string, string> | undefined | null;
    __mindzj_plugin_cm_extensions: any[] | undefined | null;
    __mindzj_plugin_settings_active_tab:
      | { id: string; containerEl: HTMLElement }
      | undefined
      | null;
    __mindzj_loadedPlugins: any[] | undefined | null;
    __mindzj_plugin_editor_api: Record<string, any> | null | undefined;
    __mindzj_markdown_view: Record<string, any> | null | undefined;
  }
}

export {};
