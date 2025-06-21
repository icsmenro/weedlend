export async function getMetadata(uri: string) {
  try {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Failed to fetch metadata');
    const metadata = await response.json();
    return {
      description: metadata.description || '',
      image: metadata.image || '',
      contact: metadata.contact || '',
      disclaimer: metadata.disclaimer || '',
    };
  } catch (err) {
    console.error('Error fetching metadata:', err);
    return { description: 'Error loading metadata', image: '', contact: '', disclaimer: '' };
  }
}