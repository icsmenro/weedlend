import { useEffect, useRef } from 'react';
import { useContractRead } from 'wagmi';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Raycaster, Vector2 } from 'three';
import { GreenFi } from '../config/contracts'; // ✅ Corrected import
import { sanitizeHTML } from '../utils/security';

interface LandListing {
  id: bigint;
  owner: string;
  metadataURI: string;
  collateralValue: bigint;
  isActive: boolean;
  loanId: bigint;
  borrowId: bigint;
  contactInfo: string;
}

interface Loan {
  id: bigint;
  borrower: string;
  landId: bigint;
  amount: bigint;
  duration: bigint;
  isActive: boolean;
  isDiscounted: boolean;
  contactInfo: string;
}

interface Borrowing {
  id: bigint;
  borrower: string;
  landId: bigint;
  duration: bigint;
  fee: bigint;
  isActive: boolean;
  isDiscounted: boolean;
  contactInfo: string;
}

interface Staking {
  user: string;
  amount: bigint;
  isActive: boolean;
}

export default function VirtualLandShowcase({ address }: { address: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const { data: landData } = useContractRead({
    address: `0x${GreenFi.address.slice(2)}` as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllLandListings',
    args: [BigInt(1), BigInt(100)],
  });

  const { data: loanData } = useContractRead({
    address: `0x${GreenFi.address.slice(2)}` as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllLoans',
    args: [BigInt(1), BigInt(100)],
  });

  const { data: borrowData } = useContractRead({
    address: `0x${GreenFi.address.slice(2)}` as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getAllLandBorrowings',
    args: [BigInt(1), BigInt(100)],
  });

  const { data: stakeData } = useContractRead({
    address: `0x${GreenFi.address.slice(2)}` as `0x${string}`,
    abi: GreenFi.abi,
    functionName: 'getUserStakes',
    args: [address as `0x${string}`],
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas || !tooltip) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1f20);
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / 600, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, 600);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.enablePan = true;
    controls.enableRotate = true;

    const gridHelper = new THREE.GridHelper(20, 10, 0x2a7f62, 0x3d3d3d);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    const plots: THREE.Mesh[] = [];
    if (landData && Array.isArray(landData) && landData.length > 0) {
      (landData as LandListing[]).forEach((listing, index) => {
        if (!listing.isActive) return;
        const loan = (loanData as Loan[])?.find((l) => l.landId === listing.id && l.isActive);
        const borrowing = (borrowData as Borrowing[])?.find((b) => b.landId === listing.id && b.isActive);
        const staked = (stakeData as Staking[])?.some((s) => s.user.toLowerCase() === address.toLowerCase() && s.isActive);

        const geometry = new THREE.BoxGeometry(1, 0.5, 1);
        const color = loan ? 0xff4d4d : borrowing ? 0x4d94ff : staked ? 0xffd700 : 0x2a7f62;
        const material = new THREE.MeshPhongMaterial({ color, specular: 0x555555, shininess: 30 });
        const plot = new THREE.Mesh(geometry, material);
        plot.position.set((index % 10) * 2 - 9, 0.25, Math.floor(index / 10) * 2 - 9);
        plot.userData = {
          listing,
          loan,
          borrowing,
          staked,
          tooltip: `
            <strong>Land ID:</strong> ${sanitizeHTML(listing.id.toString())}<br>
            <strong>Collateral:</strong> ${(Number(listing.collateralValue) / 1e18).toFixed(4)} WEEDL<br>
            <strong>Contact:</strong> ${sanitizeHTML(listing.contactInfo)}<br>
            ${loan ? `<strong>Loan:</strong> ${(Number(loan.amount) / 1e18).toFixed(4)} WEEDL, ${loan.isDiscounted ? '0.1% Discount' : ''}<br>` : ''}
            ${borrowing ? `<strong>Borrowing:</strong> ${Number(borrowing.duration) / 86400} days, ${borrowing.isDiscounted ? '0.1% Discount' : ''}<br>` : ''}
            ${staked ? `<strong>Staked:</strong> ${(Number((stakeData as Staking[])[0]?.amount) / 1e18).toFixed(4)} WEEDL` : ''}
          `,
        };
        scene.add(plot);
        plots.push(plot);
      });
    } else {
      for (let i = 0; i < 10; i++) {
        const geometry = new THREE.BoxGeometry(1, 0.5, 1);
        const material = new THREE.MeshPhongMaterial({ color: 0x2a7f62, specular: 0x555555, shininess: 30 });
        const plot = new THREE.Mesh(geometry, material);
        plot.position.set((i % 5) * 2 - 4, 0.25, Math.floor(i / 5) * 2 - 2);
        plot.userData = { tooltip: 'Fallback Plot - No Data' };
        scene.add(plot);
        plots.push(plot);
      }
    }

    const ambientLight = new THREE.AmbientLight(0x606060, 1.0);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 15, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    camera.position.set(0, 15, 25);
    camera.lookAt(0, 0, 0);

    const raycaster = new Raycaster();
    const mouse = new Vector2();

    const onMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(plots);
      if (intersects.length > 0) {
        const plot = intersects[0].object as THREE.Mesh;
        tooltip.innerHTML = plot.userData.tooltip || 'No data available';
        tooltip.style.left = `${event.clientX + 10}px`;
        tooltip.style.top = `${event.clientY + 10}px`;
        tooltip.classList.add('active');
      } else {
        tooltip.classList.remove('active');
      }
    };

    canvas.addEventListener('mousemove', onMouseMove);

    const animate = () => {
      requestAnimationFrame(animate);
      plots.forEach((plot) => {
        plot.rotation.y += 0.01;
      });
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const width = window.innerWidth;
      camera.aspect = width / 600;
      camera.updateProjectionMatrix();
      renderer.setSize(width, 600);
    };
    window.addEventListener('resize', onResize);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, [landData, loanData, borrowData, stakeData, address]);

  return (
    <div className="showcase-container">
      <h3>Virtual Land Showcase</h3>
      <p className="disclaimer">Disclaimer: Please verify the authenticity of all listings before engaging.</p>
      <canvas ref={canvasRef}></canvas>
      <div className="map-tooltip" ref={tooltipRef}></div>
      <div className="map-legend">
        <p><span className="listing"></span>Listing</p>
        <p><span className="loan"></span>Loan</p>
        <p><span className="borrowing"></span>Borrowing</p>
        <p><span className="staking"></span>Staking</p>
      </div>
    </div>
  );
}
