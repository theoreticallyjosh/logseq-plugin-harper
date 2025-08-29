import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
import { Dialect, LintConfig, LocalLinter } from "harper.js";

export type Settings = {
  ignoredLints?: string;
  useWebWorker: boolean;
  dialect?: Dialect;
  lintSettings: LintConfig;
  userDictionary?: string[];
  delay?: number;
};

export const settingsSchema: Array<SettingSchemaDesc> = [
  {
    key: "HarperDialect",
    type: "enum",
    title: "Dialect",
    default: "american",
    description: `English Dialect`,
    enumChoices: ["american", "british", "canadian", "australian"],
    enumPicker: "select",
  },
  {
    key: "HarperCustomDictionary",
    type: "string",
    title: "Custom Dictionary",
    default: "",
    description: `File path to custom dictionary`,
  },
  {
    key: "HarperUserDictionary",
    type: "string",
    title: "User Dictionary",
    default: "[]",
    description: `JSON array of words added by user`,
  },
];

export const dialects = {
  american: Dialect.American,
  austrailian: Dialect.Australian,
  british: Dialect.British,
  canadian: Dialect.Canadian,
};
export async function getSettingsSchema(linter: LocalLinter): Promise<Array<SettingSchemaDesc>> {
  var ret: Array<SettingSchemaDesc> = [];
  ret.push(...settingsSchema);

  let lds = await linter.getLintDescriptions();
  let ls = await linter.getLintConfig();
  for (const setting of Object.keys(ls)) {
    ret.push({
      key: `HarperRule${setting}`,
      type: "boolean",
      title: setting,
      description: lds[setting],
      default: ls[setting]!,
    });
  }

  return ret;
}
