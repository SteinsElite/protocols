import BN = require("bn.js");
import { expectThrow } from "./expectThrow";
import { ExchangeTestUtil } from "./testExchangeUtil";
import { Block, RingInfo } from "./types";

contract("Exchange", (accounts: string[]) => {

  let exchangeTestUtil: ExchangeTestUtil;

  const revertBlockChecked = async (realmID: number, block: Block) => {
    const LRC = await exchangeTestUtil.getTokenContract("LRC");

    const blockIdxBefore = (await exchangeTestUtil.exchange.getBlockHeight(web3.utils.toBN(realmID))).toNumber();
    const lrcBalanceBefore = await exchangeTestUtil.getOnchainBalance(exchangeTestUtil.exchange.address, "LRC");
    const lrcSupplyBefore = await LRC.totalSupply();

    await exchangeTestUtil.revertBlock(realmID, block.blockIdx);

    const blockIdxAfter = (await exchangeTestUtil.exchange.getBlockHeight(web3.utils.toBN(realmID))).toNumber();
    const lrcBalanceAfter = await exchangeTestUtil.getOnchainBalance(exchangeTestUtil.exchange.address, "LRC");
    const lrcSupplyAfter = await LRC.totalSupply();

    assert(blockIdxBefore > blockIdxAfter, "blockIdx should have decreased");
    assert.equal(blockIdxAfter, block.blockIdx - 1, "State should have been reverted to the specified block");

    assert(lrcBalanceBefore.eq(lrcBalanceAfter.add(exchangeTestUtil.STAKE_AMOUNT_IN_LRC)),
           "LRC balance of exchange needs to be reduced by STAKE_AMOUNT_IN_LRC");
    assert(lrcSupplyBefore.eq(lrcSupplyAfter.add(exchangeTestUtil.STAKE_AMOUNT_IN_LRC)),
           "LRC supply needs to be reduced by STAKE_AMOUNT_IN_LRC");
  };

  before( async () => {
    exchangeTestUtil = new ExchangeTestUtil();
    await exchangeTestUtil.initialize(accounts);
  });

  describe("Revert", function() {
    this.timeout(0);

    it("Revert block", async () => {
      const realmID = await exchangeTestUtil.createExchange(exchangeTestUtil.testContext.stateOwners[0], true);
      const ring: RingInfo = {
        orderA:
          {
            realmID,
            tokenS: "WETH",
            tokenB: "GTO",
            amountS: new BN(web3.utils.toWei("100", "ether")),
            amountB: new BN(web3.utils.toWei("10", "ether")),
            amountF: new BN(web3.utils.toWei("1", "ether")),
          },
        orderB:
          {
            realmID,
            tokenS: "GTO",
            tokenB: "WETH",
            amountS: new BN(web3.utils.toWei("5", "ether")),
            amountB: new BN(web3.utils.toWei("45", "ether")),
            amountF: new BN(web3.utils.toWei("3", "ether")),
          },
      };
      await exchangeTestUtil.setupRing(ring);
      const blocksVerified = await exchangeTestUtil.commitDeposits(realmID);
      await exchangeTestUtil.verifyPendingBlocks(realmID);

      // Try to revert proven blocks
      for (const block of blocksVerified) {
        await expectThrow(
          exchangeTestUtil.revertBlock(realmID, block.blockIdx),
          "INVALID_BLOCKSTATE",
        );
      }

      const keyPair = exchangeTestUtil.getKeyPairEDDSA();
      const owner = exchangeTestUtil.testContext.orderOwners[0];
      const wallet = exchangeTestUtil.wallets[realmID][0];
      const token = "LRC";
      const balance = new BN(web3.utils.toWei("7.1", "ether"));

      const depositInfo = await exchangeTestUtil.deposit(realmID, owner,
                                                         keyPair.secretKey, keyPair.publicKeyX, keyPair.publicKeyY,
                                                         token, balance);
      const pendingDeposits = exchangeTestUtil.getPendingDeposits(realmID);

      const blocksA = await exchangeTestUtil.commitDeposits(realmID, pendingDeposits);
      assert(blocksA.length === 1);

      // Try to notify too early
      await expectThrow(
        exchangeTestUtil.revertBlock(realmID, blocksA[0].blockIdx),
        "PROOF_NOT_TOO_LATE",
      );

      // Wait
      await exchangeTestUtil.advanceBlockTimestamp(exchangeTestUtil.MAX_PROOF_GENERATION_TIME_IN_SECONDS + 1);

      // Revert the block again, now correctly
      await revertBlockChecked(realmID, blocksA[0]);

      // Submit some other work now first
      await exchangeTestUtil.sendRing(realmID, ring);
      await exchangeTestUtil.commitRings(realmID);

      // Now commit the deposits again
      const blockIndicesB = await exchangeTestUtil.commitDeposits(realmID, pendingDeposits);
      assert(blockIndicesB.length === 1);

      // Verify all blocks
      await exchangeTestUtil.verifyPendingBlocks(realmID);
    });

  });
});