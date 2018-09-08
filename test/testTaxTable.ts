import BN = require("bn.js");
import { Artifacts, expectThrow } from "protocol2-js";

const {
  TaxTable,
  SymbolRegistry,
  TradeDelegate,
  DummyToken,
} = new Artifacts(artifacts);

contract("TaxTable", (accounts: string[]) => {
  const deployer = accounts[0];
  const mockedExchangeAddress = accounts[1];
  const user1 = accounts[2];
  const user2 = accounts[3];
  const user3 = accounts[4];
  const user4 = accounts[5];

  let taxTable: any;
  let symbolRegistry: any;
  let tokenLRC: string;
  let tokenWETH: string;
  const token1 = "0x" + "1".repeat(40);
  const token2 = "0x" + "2".repeat(40);
  const token3 = "0x" + "3".repeat(40);
  const token4 = "0x" + "4".repeat(40);

  const assertNumberEqualsWithPrecision = (n1: number, n2: number, description: string, precision: number = 8) => {
    const numStr1 = (n1 / 1e18).toFixed(precision);
    const numStr2 = (n2 / 1e18).toFixed(precision);

    return assert.equal(Number(numStr1), Number(numStr2), description);
  };

  const getTierRate = async (tier: number) => {
    if (tier === 1) {
      const matching = (await taxTable.TAX_MATCHING_TIER1()).toNumber();
      const P2P = (await taxTable.TAX_P2P_TIER1()).toNumber();
      return [matching, P2P];
    } else if (tier === 2) {
      const matching = (await taxTable.TAX_MATCHING_TIER2()).toNumber();
      const P2P = (await taxTable.TAX_P2P_TIER2()).toNumber();
      return [matching, P2P];
    } else if (tier === 3) {
      const matching = (await taxTable.TAX_MATCHING_TIER3()).toNumber();
      const P2P = (await taxTable.TAX_P2P_TIER3()).toNumber();
      return [matching, P2P];
    } else if (tier === 4) {
      const matching = (await taxTable.TAX_MATCHING_TIER4()).toNumber();
      const P2P = (await taxTable.TAX_P2P_TIER4()).toNumber();
      return [matching, P2P];
    } else {
      assert(false, "Invalid tier");
    }
  };

  const getTokenRate = async (user: string, token: string) => {
    const matching = (await taxTable.getTaxRate(user1, token, false)).toNumber();
    const P2P = (await taxTable.getTaxRate(user1, token, true)).toNumber();
    return [matching, P2P];
  };

  const checkTokenTier = async (user: string, token: string, tier: number) => {
    const [matchingToken, P2PToken] = await getTokenRate(user, token);
    const [matchingTier, P2PTier] = await getTierRate(tier);
    assert.equal(matchingToken, matchingTier, "matching rate needs to match tier " + tier + " rate");
    assert.equal(P2PToken, P2PTier, "P2P rate needs to match tier " + tier + " rate");
  };

  before(async () => {
    symbolRegistry = await SymbolRegistry.deployed();
    tokenLRC = await symbolRegistry.getAddressBySymbol("LRC");
    tokenWETH = await symbolRegistry.getAddressBySymbol("WETH");
  });

  beforeEach(async () => {
    // Fresh FeeHolder for each test
    taxTable = await TaxTable.new(tokenLRC, tokenWETH);
  });

  describe("general", () => {
    it("LRC should be tier 1", async () => {
      checkTokenTier(user1, tokenLRC, 1);
    });

    it("WETH should be tier 2", async () => {
      checkTokenTier(user1, tokenWETH, 2);
    });

    it("Any other tokens should default to tier 4", async () => {
      checkTokenTier(user1, token1, 4);
    });
  });

  describe("anyone", () => {
    it("should be able to upgrade the tier of a token by burning enough tokens", async () => {
      const LRC = await DummyToken.at(tokenLRC);
      const totalLRCSupply = await LRC.totalSupply();

      // Calculate the needed funds to upgrade the tier
      const basePercentage = (await taxTable.BASE_PERCENTAGE()).toNumber();
      const upgradeCostPercentage = (await taxTable.TIER_UPGRADE_COST_PERCENTAGE()).toNumber();
      const upgradeAmount = Math.floor(totalLRCSupply * upgradeCostPercentage / basePercentage);

      // Have the user have a bit more balance
      const balance = upgradeAmount + 1e20;

      // Make sure the user has enough LRC
      await LRC.transfer(user1, balance, {from: deployer});
      await LRC.approve(taxTable.address, balance, {from: user1});

      // Token should still be at tier 4
      await checkTokenTier(user1, token1, 4);
      // Upgrade
      await taxTable.upgradeTokenTier(token1, {from: user1});
      // Token should now be at tier 3
      checkTokenTier(user1, token1, 3);

      // Balance of the owner should have been depleted by the upgrade amount
      const currentBalance = (await LRC.balanceOf(user1)).toNumber();
      assertNumberEqualsWithPrecision(
        currentBalance, balance - upgradeAmount,
        "Balance of the burner should be depleted by burn amount",
      );

      // New LRC total supply should be upgradeAmount less
      const newTotalLRCSupply = await LRC.totalSupply();
      assertNumberEqualsWithPrecision(
        newTotalLRCSupply, totalLRCSupply - upgradeAmount,
        "LRC upgrade amount needs te be burned",
      );
    });

    it("should not be able to upgrade the tier of a token by not burning enough tokens", async () => {
      const LRC = await DummyToken.at(tokenLRC);
      const totalLRCSupply = await LRC.totalSupply();

      // Calculate the needed funds to upgrade the tier
      const basePercentage = (await taxTable.BASE_PERCENTAGE()).toNumber();
      const upgradeCostPercentage = (await taxTable.TIER_UPGRADE_COST_PERCENTAGE()).toNumber();
      const upgradeAmount = Math.floor(totalLRCSupply * upgradeCostPercentage / basePercentage);

      // Not enought funds
      const balance = upgradeAmount / 2;

      // Make sure the user has enough LRC
      await LRC.transfer(user1, balance, {from: deployer});
      await LRC.approve(taxTable.address, upgradeAmount, {from: user1});

      // Try to upgrade
      await expectThrow(taxTable.upgradeTokenTier(token1, {from: user1}));
    });

    it("should not be able to upgrade the tier of LRC or WETH by burning enough tokens", async () => {
      const LRC = await DummyToken.at(tokenLRC);
      const totalLRCSupply = await LRC.totalSupply();

      // Calculate the needed funds to upgrade the tier
      const basePercentage = (await taxTable.BASE_PERCENTAGE()).toNumber();
      const upgradeCostPercentage = (await taxTable.TIER_UPGRADE_COST_PERCENTAGE()).toNumber();
      const upgradeAmount = Math.floor(totalLRCSupply * upgradeCostPercentage / basePercentage);

      // Have the user have a bit more balance
      const balance = upgradeAmount + 1e20;

      // Make sure the user has enough LRC
      await LRC.transfer(user1, balance, {from: deployer});
      await LRC.approve(taxTable.address, balance, {from: user1});

      // Try to upgrade LRC
      await expectThrow(taxTable.upgradeTokenTier(tokenLRC, {from: user1}));

      // Try to upgrade WETH
      await expectThrow(taxTable.upgradeTokenTier(tokenWETH, {from: user1}));
    });

    it("can lower burn rate by locking LRC", async () => {
      // TODO
    });
  });

});
