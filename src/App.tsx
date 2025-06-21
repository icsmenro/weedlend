import { useAppKitAccount, useAppKitNetwork, useAppKit } from '@reown/appkit/react';
import { useState, useEffect } from 'react';
import { isAddress } from 'viem';
import { sanitizeHTML } from './utils/security';
import LandListingForm from './components/LandListingForm';
import SeedListingForm from './components/SeedListingForm';
import StakingForm from './components/StakingForm';
import LandListings from './components/LandListings';
import SeedListings from './components/SeedListings';
import VirtualLandListings from './components/VirtualLandListings';
import VirtualLandShowcase from './components/VirtualLandShowcase';
import LandBorrowings from './components/LandBorrowings';
import './index.css';

function App() {
  const { address, isConnected } = useAppKitAccount();
  const { caipNetwork } = useAppKitNetwork();
  const { open } = useAppKit();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  useEffect(() => {
    const handleModalOpen = () => setIsHeaderVisible(false);
    const handleModalClose = () => setIsHeaderVisible(true);

    window.addEventListener('appkit:modal:open', handleModalOpen);
    window.addEventListener('appkit:modal:close', handleModalClose);

    return () => {
      window.removeEventListener('appkit:modal:open', handleModalOpen);
      window.removeEventListener('appkit:modal:close', handleModalClose);
    };
  }, []);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsHeaderVisible(false);
      } else if (currentScrollY < lastScrollY) {
        setIsHeaderVisible(true);
      }
      lastScrollY = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isValidAddress = address ? isAddress(address) : false;
  const sanitizedNetworkName = sanitizeHTML(caipNetwork?.name || 'Unknown');
  const sanitizedAddress = address && isValidAddress
    ? sanitizeHTML(`${address.slice(0, 6)}...${address.slice(-4)}`)
    : sanitizeHTML('Invalid Address');

  return (
    <>
      <header role="banner" className={isHeaderVisible ? 'visible' : 'hidden'}>
        <div className="container header-content">
          <div className="logo" aria-label="WeedLend Finance logo">
            <h1 className="logo-text">
              <span className="weed-lend-highlight">Weed</span>Lend Finance
            </h1>
          </div>
          <nav aria-label="Main navigation">
            <button
              className="menu-toggle"
              aria-label="Toggle navigation menu"
              aria-expanded={isMenuOpen}
              onClick={toggleMenu}
            >
              ☰
            </button>
            <div className={`nav-container ${isMenuOpen ? 'open' : ''}`}>
              <ul className="nav-menu">
                <li><a href="#growers" onClick={toggleMenu}>Growers</a></li>
                <li><a href="#lenders" onClick={toggleMenu}>Lenders</a></li>
                <li><a href="#seeds" onClick={toggleMenu}>Seeds</a></li>
                <li><a href="#borrow" onClick={toggleMenu}>Borrow</a></li>
                <li><a href="#metaverse" onClick={toggleMenu}>Metaverse</a></li>
                <li><a href="#stake" onClick={toggleMenu}>Stake</a></li>
              </ul>
            </div>
          </nav>
          <div className="wallet-container">
            <appkit-button />
            {isConnected && (
              <>
                <span className="network-status" aria-live="polite">
                  <span className="status-icon" aria-hidden="true"></span>
                  <span
                    className="status-text"
                    dangerouslySetInnerHTML={{ __html: sanitizedNetworkName }}
                  />
                </span>
                <span
                  className="balance"
                  aria-label="Wallet address"
                  dangerouslySetInnerHTML={{ __html: sanitizedAddress }}
                />
                <button
                  className="network-switch"
                  aria-label="Switch network"
                  onClick={() => open({ view: 'Networks' })}
                >
                  Switch Network
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main-content">
        <section className="hero" aria-label="Introduction to WeedLend Finance">
          <div className="container">
            <h1>
              Empowering <span className="highlight">Cannabis</span> Finance
            </h1>
            <p>
              Secure decentralized funding, land loans, seed purchases, land borrowing, and virtual
              showcases for <span className="highlight">Cannabis</span> growers and lenders. 
              Special 0.1% discount on fees for transactions within the first 30 days!
            </p>
            <p className="disclaimer">
              Disclaimer: Please verify the authenticity of all listings before engaging. 
              Transaction fees are 0.420%. Staking and lending rewards are fixed at 4.20%.
            </p>
            <button
              className="cta-button"
              aria-label="Explore WeedLend Finance services"
            >
              Explore Now
            </button>
          </div>
        </section>
        <section className="services" aria-label="Our Services">
          <div className="container">
            <h2>Our Services</h2>
            <div className="description-grid">
              <div className="description-item">
                <h3>Growers</h3>
                <p>
                  Access funding for <span className="highlight">Cannabis</span>{' '}
                  cultivation by listing land as collateral.
                </p>
              </div>
              <div className="description-item">
                <h3>Lenders</h3>
                <p>
                  Provide loans to <span className="highlight">Cannabis</span> growers
                  and earn interest, secured by blockchain.
                </p>
              </div>
              <div className="description-item">
                <h3>Seeds</h3>
                <p>
                  Purchase high-quality <span className="highlight">Cannabis</span>{' '}
                  seeds to start or expand cultivation.
                </p>
              </div>
              <div className="description-item">
                <h3>Borrow</h3>
                <p>
                  Borrow land for <span className="highlight">Cannabis</span>{' '}
                  cultivation with flexible terms.
                </p>
              </div>
              <div className="description-item">
                <h3>Metaverse</h3>
                <p>Explore virtual land showcases in a 3D environment.</p>
              </div>
              <div className="description-item">
                <h3>Stake</h3>
                <p>Stake WEEDL tokens to earn rewards and support the ecosystem.</p>
              </div>
            </div>
          </div>
        </section>
        <section id="growers" className="section" aria-label="Growers Section">
          <div className="container">
            <h2>Our Growers</h2>
            {isConnected ? (
              <>
                <LandListingForm />
                <LandListings address={address!} />
              </>
            ) : (
              <p>Connect your wallet to list or view land.</p>
            )}
          </div>
        </section>
        <section id="lenders" className="section" aria-label="Lenders Section">
          <div className="container">
            <h2>Our Lenders</h2>
            {isConnected ? (
              <LandListings address={address!} />
            ) : (
              <p>Connect your wallet to create or view loans.</p>
            )}
          </div>
        </section>
        <section id="seeds" className="section" aria-label="Seeds Section">
          <div className="container">
            <h2>Buy Seeds</h2>
            {isConnected ? (
              <>
                <SeedListingForm />
                <SeedListings address={address!} />
              </>
            ) : (
              <p>Connect your wallet to list or purchase seeds.</p>
            )}
          </div>
        </section>
        <section id="borrow" className="section" aria-label="Borrow Section">
          <div className="container">
            <h2>Borrow Land</h2>
            {isConnected ? (
              <LandBorrowings address={address!} />
            ) : (
              <p>Connect your wallet to borrow or view land borrowings.</p>
            )}
          </div>
        </section>
        <section id="metaverse" className="section" aria-label="Virtual Land Showcase">
          <div className="container">
            <h2>
              Virtual <span className="land-highlight">Land</span> Showcase
            </h2>
            {isConnected ? (
              <>
                <VirtualLandListings address={address!} />
                <VirtualLandShowcase address={address!} />
              </>
            ) : (
              <p>Connect your wallet to showcase or view virtual land.</p>
            )}
          </div>
        </section>
        <section id="stake" className="section" aria-label="Token Staking">
          <div className="section" aria-label="section">
            <h2>Stake Tokens</h2>
            {isConnected ? (
              <StakingForm address={address!} />
            ) : (
              <p>Connect your wallet to stake tokens.</p>
            )}
          </div>
        </section>
      </main>
      <footer role="contentinfo">
        <div className="container">
          <p>
            © 2025 <span className="weed-lend-highlight">Weed</span>Lend Finance. All
            rights reserved.
          </p>
          <nav aria-label="Footer navigation">
            <a href="/contact" aria-label="Contact WeedLend Finance support">
              Contact
            </a>
            <a href="/privacy" aria-label="View WeedLend Finance privacy policy">
              Privacy Policy
            </a>
            <a href="/terms" aria-label="View WeedLend Finance terms of service">
              Terms
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}

export default App;