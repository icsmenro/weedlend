import { useAppKitAccount, useAppKitNetwork, useAppKit } from "@reown/appkit/react";
import { useState, useEffect, Component, ReactNode } from "react";
import { isAddress } from "viem";
import { sanitizeHTML } from "./utils/security";
import LandListingForm from "./components/LandListingForm";
import SeedListingForm from "./components/SeedListingForm";
import StakingForm from "./components/StakingForm";
import LandListings from "./components/LandListings";
import SeedListings from "./components/SeedListings";
import VirtualLandShowcase from "./components/VirtualLandShowcase";
import LoanListings from "./components/LoanListings";
import LoanListingForm from "./components/LoanListingForm";
import ProductsListingForm from "./components/ProductsListingForm"; // Added
import ProductsListings from "./components/ProductsListings"; // Added
import "./index.css";
import StakingListings from "./components/StakingListings";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <p>Something went wrong in the component. Please try again or contact support.</p>;
    }
    return this.props.children;
  }
}

function App() {
  const { address: rawAddress, isConnected } = useAppKitAccount();
  const { caipNetwork } = useAppKitNetwork();
  const { open } = useAppKit();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [modals, setModals] = useState({
    growers: false,
    lenders: false,
    seeds: false,
    products: false, // Changed from "borrow" to "products"
    metaverse: false,
    stake: false,
  });
  const [selectedStakeUUID, setSelectedStakeUUID] = useState<string | null>(null);
  const [selectedStakeAmount, setSelectedStakeAmount] = useState<bigint | null>(null);

  // Validate and cast address to `0x${string} | undefined`
  const address: `0x${string}` | undefined = rawAddress && isAddress(rawAddress)
    ? rawAddress as `0x${string}`
    : undefined;

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const openModal = (modalId: keyof typeof modals) => {
    setModals((prev) => ({ ...prev, [modalId]: true }));
    document.body.classList.add("modal-open");
  };

  const closeModal = (modalId: keyof typeof modals) => {
    setModals((prev) => ({ ...prev, [modalId]: false }));
    document.body.classList.remove("modal-open");
  };

  const handleSelectStake = (uuid: string, amount: bigint) => {
    setSelectedStakeUUID(uuid);
    setSelectedStakeAmount(amount);
  };

  useEffect(() => {
    const handleModalOpen = () => setIsHeaderVisible(false);
    const handleModalClose = () => setIsHeaderVisible(true);

    window.addEventListener("appkit:modal:open", handleModalOpen);
    window.addEventListener("appkit:modal:close", handleModalClose);

    return () => {
      window.removeEventListener("appkit:modal:open", handleModalOpen);
      window.removeEventListener("appkit:modal:close", handleModalClose);
      document.body.classList.remove("modal-open");
    };
  }, []);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 50) {
        setIsHeaderVisible(false);
      } else if (currentScrollY < lastScrollY) {
        setIsHeaderVisible(true);
      }
      lastScrollY = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isValidAddress = address ? isAddress(address) : false;
  const sanitizedNetworkName = sanitizeHTML(caipNetwork?.name || "Unknown");
  const sanitizedAddress = address && isValidAddress
    ? sanitizeHTML(`${address.slice(0, 5)}...${address.slice(-4)}`)
    : sanitizeHTML("Invalid Address");

  return (
    <>
      <header role="banner" className={isHeaderVisible ? "visible" : "hidden"}>
        <div className="container header-content">
          <div className="logo" aria-label="WeedLend Finance Logo">
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
            <div className={`nav-container ${isMenuOpen ? "open" : ""}`}>
              <ul className="nav-menu">
                <li>
                  <a
                    href="#growers"
                    onClick={(e) => {
                      e.preventDefault();
                      openModal("growers");
                      toggleMenu();
                    }}
                  >
                    Growers
                  </a>
                </li>
                <li>
                  <a
                    href="#lenders"
                    onClick={(e) => {
                      e.preventDefault();
                      openModal("lenders");
                      toggleMenu();
                    }}
                  >
                    Lenders
                  </a>
                </li>
                <li>
                  <a
                    href="#seeds"
                    onClick={(e) => {
                      e.preventDefault();
                      openModal("seeds");
                      toggleMenu();
                    }}
                  >
                    Seeds
                  </a>
                </li>
                <li>
                  <a
                    href="#products" // Changed from "borrow" to "products"
                    onClick={(e) => {
                      e.preventDefault();
                      openModal("products");
                      toggleMenu();
                    }}
                  >
                    Products
                  </a>
                </li>
                <li>
                  <a
                    href="#metaverse"
                    onClick={(e) => {
                      e.preventDefault();
                      openModal("metaverse");
                      toggleMenu();
                    }}
                  >
                    Metaverse
                  </a>
                </li>
                <li>
                  <a
                    href="#stake"
                    onClick={(e) => {
                      e.preventDefault();
                      openModal("stake");
                      toggleMenu();
                    }}
                  >
                    Stake
                  </a>
                </li>
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
                  onClick={() => open({ view: "Networks" })}
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
              Secure decentralized funding, land loans, seed and product purchases, land lending, and
              virtual showcases for <span className="highlight">Cannabis</span> growers and
              lenders.
            </p>
            <p className="disclaimer">
              Disclaimer: Please verify the authenticity of all listings before engaging.
              Transaction fees are 0.420%. Staking and lending rewards are 4.20%.
            </p>
            <button
              className="cta-button"
              aria-label="Explore WeedLend Finance services"
            >
              Explore Now
            </button>
          </div>
        </section>
        <section className="services" aria-label="Services Section">
          <div className="container">
            <h2>Our Services</h2>
            <div className="description-grid">
              <div className="description-item" onClick={() => openModal("growers")}>
                <h3>Growers</h3>
                <p>
                  Buy/sell or lease lands for <span className="highlight">Cannabis</span> cultivation.
                </p>
              </div>
              <div className="description-item" onClick={() => openModal("lenders")}>
                <h3>Lenders</h3>
                <p>
                  Provide loans to <span className="highlight">Cannabis</span> growers and
                  earn interest, secured by blockchain.
                </p>
              </div>
              <div className="description-item" onClick={() => openModal("seeds")}>
                <h3>Seeds</h3>
                <p>
                  Purchase high-quality <span className="highlight">Cannabis</span> seeds to
                  start or expand cultivation.
                </p>
              </div>
              <div className="description-item" onClick={() => openModal("products")}>
                <h3>Products</h3>
                <p>
                  Buy or sell <span className="highlight">Cannabis</span> products like oils
                  and edibles on our decentralized marketplace.
                </p>
              </div>
              <div className="description-item" onClick={() => openModal("metaverse")}>
                <h3>Metaverse</h3>
                <p>Explore virtual land showcases in a 3D environment.</p>
              </div>
              <div className="description-item" onClick={() => openModal("stake")}>
                <h3>Stake</h3>
                <p>Stake WEEDL tokens to earn rewards and support the ecosystem.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      {modals.growers && (
        <div className="modal" role="dialog" aria-label="Growers Modal">
          <div className="modal-content">
            <button
              className="modal-close"
              onClick={() => closeModal("growers")}
              aria-label="Close modal"
            >
              ×
            </button>
            <section id="growers" className="section" aria-label="Growers Section">
              <div className="container">
                <h2>Our Growers</h2>
                <ErrorBoundary>
                  <LandListingForm />
                </ErrorBoundary>
                {address && <LandListings address={address} />}
              </div>
            </section>
          </div>
        </div>
      )}
      {modals.lenders && (
        <div className="modal" role="dialog" aria-label="Lenders Modal">
          <div className="modal-content">
            <button
              className="modal-close"
              onClick={() => closeModal("lenders")}
              aria-label="Close modal"
            >
              ×
            </button>
            <section id="lenders" className="section" aria-label="Lenders Section">
              <div className="container">
                <h2>Our Lenders</h2>
                <ErrorBoundary>
                  <LoanListingForm address={address} />
                </ErrorBoundary>
                {address && <LoanListings address={address} />}
              </div>
            </section>
          </div>
        </div>
      )}
      {modals.seeds && (
        <div className="modal" role="dialog" aria-label="Seeds Modal">
          <div className="modal-content">
            <button
              className="modal-close"
              onClick={() => closeModal("seeds")}
              aria-label="Close modal"
            >
              ×
            </button>
            <section id="seeds" className="section" aria-label="Seeds Section">
              <div className="container">
                <h2>Buy Seeds</h2>
                <ErrorBoundary>
                  <SeedListingForm />
                </ErrorBoundary>
                {address && <SeedListings address={address} />}
              </div>
            </section>
          </div>
        </div>
      )}
      {modals.products && (
        <div className="modal" role="dialog" aria-label="Products Modal">
          <div className="modal-content">
            <button
              className="modal-close"
              onClick={() => closeModal("products")}
              aria-label="Close modal"
            >
              ×
            </button>
            <section id="products" className="section" aria-label="Products Section">
              <div className="container">
                <h2>Buy Products</h2>
                <ErrorBoundary>
                  <ProductsListingForm />
                </ErrorBoundary>
                {address && <ProductsListings address={address} />}
              </div>
            </section>
          </div>
        </div>
      )}
      {modals.metaverse && (
        <div className="modal" role="dialog" aria-label="Metaverse Modal">
          <div className="modal-content">
            <button
              className="modal-close"
              onClick={() => closeModal("metaverse")}
              aria-label="Close modal"
            >
              ×
            </button>
            <section id="metaverse" className="section" aria-label="Virtual Land Showcase Section">
              <div className="container">
                <h2>
                  Virtual <span className="land-highlight">Land</span> Showcase
                </h2>
                {address && <VirtualLandShowcase address={address} />}
              </div>
            </section>
          </div>
        </div>
      )}
      {modals.stake && (
        <div className="modal" role="dialog" aria-label="Stake Modal">
          <div className="modal-content">
            <button
              className="modal-close"
              onClick={() => closeModal("stake")}
              aria-label="Close modal"
            >
              ×
            </button>
            <section id="stake" className="section" aria-label="Stake Section">
              <div className="container">
                <h2>Stake Tokens</h2>
                <ErrorBoundary>
                  <StakingForm
                    address={address}
                    selectedStakeUUID={selectedStakeUUID}
                    selectedStakeAmount={selectedStakeAmount}
                  />
                </ErrorBoundary>
                {address && (
                  <StakingListings
                    address={address}
                    onSelectStake={handleSelectStake}
                  />
                )}
              </div>
            </section>
          </div>
        </div>
      )}
      <footer role="contentinfo">
        <div className="container">
          <p>
            © 2025 <span className="weed-lend-highlight">WeedLend Finance</span>. All rights
            reserved.
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