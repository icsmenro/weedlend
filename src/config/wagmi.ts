import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { mainnet, arbitrum, sepolia, polygon, bsc } from '@reown/appkit/networks';
import { createStorage, cookieStorage } from 'wagmi';
import { QueryClient } from '@tanstack/react-query';
import type { AppKitNetwork } from '@reown/appkit/networks';

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;
if (!projectId) {
  throw new Error('VITE_REOWN_PROJECT_ID is not set in .env');
}

const metadata = {
  name: 'WeedLend Finance',
  description: 'WeedLend Factory',
  url: 'https://weedlend.vercel.app',
  icons: ['/canna.png'],
};

const networks: AppKitNetwork[] = [mainnet, arbitrum, sepolia, polygon, bsc] as AppKitNetwork[];

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  networks: networks as [AppKitNetwork, ...AppKitNetwork[]],
  projectId,
});

export const queryClient = new QueryClient();

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: networks as [AppKitNetwork, ...AppKitNetwork[]],
  metadata,
  features: {
    analytics: true,
  },
});