import { describe, expect, it } from "vitest";
import { boothLine, pixivCaption, pixivSaveNames } from "./pixiv-names";

const W = "20261124_喜多郁代(ケモコス)";
describe("pixivSaveNames", () => {
  it("サムネは00、サンプルはグループをまたいで連番、告知タイルは続きの番号", () => {
    const n = pixivSaveNames(W, [{ name: "0.jpg" }, { name: "01_前戯_03.jpg" }, { name: "02_前戯_07.jpg" }, { name: "03_本番_01.jpg" }, { name: "04_booth.jpg" }]);
    expect(n.get("0.jpg")).toBe(`00_${W}.jpg`);
    expect(n.get("01_前戯_03.jpg")).toBe(`01_${W}_前戯.jpg`);
    expect(n.get("02_前戯_07.jpg")).toBe(`02_${W}_前戯.jpg`);
    expect(n.get("03_本番_01.jpg")).toBe(`03_${W}_本番.jpg`);
    expect(n.get("04_booth.jpg")).toBe(`04_${W}_booth.jpg`);
  });
  it("グループ名に_があっても崩れない", () => {
    expect(pixivSaveNames("w", [{ name: "01_a_b_05.jpg" }]).get("01_a_b_05.jpg")).toBe("01_w_a_b.jpg");
  });
});
describe("boothLine", () => {
  it("MM/DD タイトル_n枚", () => {
    expect(boothLine(W, 59)).toBe("11/24 喜多郁代(ケモコス)_59枚");
  });
});

describe("pixivCaption", () => {
  it("枚数と月(日本語・英語)が入る", () => {
    expect(pixivCaption(W, 156)).toBe("Total: 156 images / Booth11月まとめに同梱 Included in the November Compilation on BOOTH!\n(プロフにリンクあり / Link available on profile page)");
    expect(pixivCaption("20260305_x", 3)).toContain("Booth3月まとめに同梱 Included in the March Compilation");
  });
});
