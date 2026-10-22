import { describe, expect, it } from "vitest";
import { en, type Key } from "./i18n/en";
import { ru } from "./i18n/ru";
import { ky } from "./i18n/ky";
import { translate, translateError } from "./i18n";
import { describeOp, validateOps } from "./edits";
import { shoeSheet } from "./fixtures";

const placeholders = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();

describe("translations", () => {
  for (const [name, dict] of [["ru", ru], ["ky", ky]] as const) {
    it(`${name}: every text is filled in and keeps the same placeholders`, () => {
      for (const key of Object.keys(en) as Key[]) {
        expect(dict[key].trim(), key).not.toBe("");
        expect(placeholders(dict[key]), key).toEqual(placeholders(en[key]));
      }
    });
  }

  it("picks Russian plural forms", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => translate("ru", "n_prices", { n }))).toEqual([
      "1 цена", "2 цены", "5 цен", "11 цен", "21 цена", "22 цены", "25 цен",
    ]);
    expect(translate("en", "n_prices", { n: 1 })).toBe("1 price");
    expect(translate("ky", "n_prices", { n: 5 })).toBe("5 баа");
  });

  it("translates server errors it knows, and leaves others as they are", () => {
    expect(translateError("ru", "Wrong email or password.")).toBe("Неверная почта или пароль.");
    expect(translateError("ky", "Wrong email or password.")).toBe("Почта же сырсөз туура эмес.");
    expect(translateError("ru", "Kapso said no")).toBe("Kapso said no");
  });

  it("describes proposed changes in the owner's language", () => {
    const sheet = shoeSheet();
    expect(describeOp({ op: "set_hours", text: "09:00–21:00" }, sheet, "ru")).toBe("Часы работы: 10:00–20:00 → 09:00–21:00");
    expect(describeOp({ op: "set_fact", topic: "Оплата", text: "Мбанк" }, sheet, "ky")).toBe("Маалымат кошуу: Оплата — «Мбанк»");
    expect(validateOps([{ op: "set_price", item: "Манты", amount: 300 }], sheet, "манты добавьте", "ru").dropped).toEqual(["цена для «Манты»"]);
  });
});
