import { getDefaultProvider, Wallet } from 'ethers'; // ethers v5
import 'dotenv/config';

import { ImmutableRpcUrl } from '../lib/constants';

import { config, orderbook } from '@imtbl/sdk';

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.MINTER_PRIVATE_KEY;
const PUBLISHABLE_API_KEY = process.env.PUBLISHABLE_API_KEY; // Replace with your Publishable Key from the Immutable Hub
const provider = getDefaultProvider(ImmutableRpcUrl.Testnet);

const NFT_COLLECTION_ADDRESS = '0x5e2cd90375bfbc64e0b52fedfd854c9ec8afe37a';

const listListings = async (client: orderbook.Orderbook) => {
  const listedOrders = await client.listListings({
    sellItemContractAddress: NFT_COLLECTION_ADDRESS,
    status: orderbook.OrderStatusName.ACTIVE,
    pageSize: 50,
  });

  for (const listing of listedOrders.result) {
    console.log(listing.id);
  }

  console.log('Listings: ' + listedOrders.result);
};

const getActiveListing = async (client: orderbook.Orderbook): Promise<string> => {
  const listedOrders = await client.listListings({
    sellItemContractAddress: NFT_COLLECTION_ADDRESS,
    status: orderbook.OrderStatusName.ACTIVE,
    pageSize: 50,
  });

  for (const listing of listedOrders.result) {
    return listing.id;
  }

  return "";

};

const cancelListings = async (
  client: orderbook.Orderbook,
  signer: Wallet,
  listingIds: string[]
) => {
  const account = await signer.getAddress();

  const { signableAction } = await client.prepareOrderCancellations(listingIds);
  const cancellationSignature = await signer._signTypedData(
    signableAction.message.domain,
    signableAction.message.types,
    signableAction.message.value,
  )

  return client.cancelOrders(listingIds, account, cancellationSignature);
};

const prepareERC721Listing = async (
  client: orderbook.Orderbook,
  signer: Wallet,
): Promise<{preparedListing: orderbook.PrepareListingResponse, orderSignature: string}> => {
  const offerer = await signer.getAddress();
  
  const activeListingId = await getActiveListing(client);
  // const cancelledOrders = await cancelListings(client, signer, [activeListingId]);
  // console.log('Cancelled: ', cancelledOrders);

  const preparedListing = await client.prepareListing({
    makerAddress: offerer,
    // native payment token
    buy: {
      amount: '1000000000000000000',
      type: 'NATIVE',
    },
    // ERC721 sell token
    sell: {
      contractAddress: '0x5e2cd90375bfbc64e0b52fedfd854c9ec8afe37a',
      tokenId: '4',
      type: 'ERC721',
    },
  });

  // The network has introduced a minimum gas price of 100 Gwei to protect it against SPAM traffic, ensure it can process transactions efficiently and remain cost-effective.
  // Transactions with a tip cap below 100 Gwei are rejected by the RPC. This limit ensures a standard for transaction costs. This also implies that the fee cap must be greater than or equal to 100 Gwei.
  const gasOverrides = {
    maxPriorityFeePerGas: 10e9, // 100 Gwei
    maxFeePerGas: 15e9,
    gasLimit: 400000, // Set an appropriate gas limit for your transaction
  };

  let orderSignature = ''
  for (const action of preparedListing.actions) {
    // If the user hasn't yet approved the Immutable Seaport contract to transfer assets from this
    // collection on their behalf they'll need to do so before they create an order
    if (action.type === orderbook.ActionType.TRANSACTION) {
      const builtTx = await action.buildTransaction();

      const txWithGasOverrides = {
        ...builtTx,
        ...gasOverrides
      };

      console.log(`Submitting ${action.purpose} transaction`)
      await signer.sendTransaction(txWithGasOverrides);
    }

    // For an order to be created (and subsequently filled), Immutable needs a valid signature for the order data.
    // This signature is stored off-chain and is later provided to any user wishing to fulfil the open order.
    // The signature only allows the order to be fulfilled if it meets the conditions specified by the user that created the listing.
    if (action.type === orderbook.ActionType.SIGNABLE) {
      orderSignature = await signer._signTypedData(
        action.message.domain,
        action.message.types,
        action.message.value,
      )
    }
  }

  return { preparedListing, orderSignature }
};

const createListing = async (
  client: orderbook.Orderbook,
  preparedListing: orderbook.PrepareListingResponse,
  orderSignature: string
): Promise<void> => {
  const order = await client.createListing({
    orderComponents: preparedListing.orderComponents,
    orderHash: preparedListing.orderHash,
    orderSignature,
    // Optional maker marketplace fee
    makerFees: [],
    //makerFees: [{
    //  amount: '100',
    //  recipientAddress: '0xFooBar', // Replace address with your own marketplace address
    //}],
  });
  console.log('New listing: ', order);
};

const client = new orderbook.Orderbook({
  baseConfig: {
    environment: config.Environment.SANDBOX,
    publishableKey: PUBLISHABLE_API_KEY,
  },
});
console.log('Orderbook Client: ', client);

// The wallet of the intended signer of the mint request
const signer = new Wallet(PRIVATE_KEY!, provider);

prepareERC721Listing(client, signer).then(
  (response)=>{
    console.log('prepareResponse: ', response.preparedListing);
    console.log('orderSignature: ', response.orderSignature);

    console.log('Creating a new listing..');

    createListing(client, response.preparedListing, response.orderSignature).then(
      () => {
        console.log('Listing existing orders for NFT');
        listListings(client);
      }
    )
  }
);