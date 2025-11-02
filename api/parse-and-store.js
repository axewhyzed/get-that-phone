import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

function cleanText(text) {
    if (!text) return null;
    return text.trim().replace(/\s+/g, ' ').replace(/\n+/g, ' ');
}

function extractSpecsFromHTML($) {
    const specs = {
        metadata: {},
        specs: {}
    };

    try {
        const phoneName = $('h1.prd_title, h1').first().text();
        if (phoneName) {
            specs.metadata['Phone Name'] = cleanText(phoneName);
        }

        const releaseDate = $('#release-cal').attr('data-content');
        if (releaseDate) {
            specs.metadata['Release Date'] = cleanText(releaseDate);
        }

        const price = $('.pricesection_cntr, .storeprices').first().text();
        if (price) {
            specs.metadata['Price'] = cleanText(price);
        }

        $('tbody[id$="-specs"]').each((index, tbody) => {
            const $tbody = $(tbody);
            const tbodyId = $tbody.attr('id');
            
            let categoryName = tbodyId
                .replace('-specs', '')
                .replace('&amp;', '&')
                .replace(/-/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            const $parentSection = $tbody.closest('section');
            if ($parentSection.length) {
                const categoryHeader = $parentSection.find('h2.key-spec-ttl').first().text();
                if (categoryHeader) {
                    categoryName = cleanText(categoryHeader);
                }
            }

            if (!specs.specs[categoryName]) {
                specs.specs[categoryName] = {};
            }

            $tbody.find('tr').each((idx, row) => {
                const $row = $(row);
                const specName = cleanText($row.find('td.spl_heading').text());
                const specValue = cleanText($row.find('td.spl_text').text());
                
                if (specName && specValue) {
                    specs.specs[categoryName][specName] = specValue;
                }
            });
        });

        Object.keys(specs.specs).forEach(category => {
            if (Object.keys(specs.specs[category]).length === 0) {
                delete specs.specs[category];
            }
        });

    } catch (error) {
        console.error('Error extracting specs:', error);
    }

    return specs;
}

function extractImages($) {
    const images = {
        gallery: [],
        other: []
    };

    try {
        const seenUrls = new Set();
        
        $('.sliderImage, img[alt*="Galaxy"], img[alt*="iPhone"]').each((index, img) => {
            const $img = $(img);
            const src = $img.attr('src') || $img.attr('data-src');
            const alt = $img.attr('alt');
            
            if (src && !seenUrls.has(src) && src.includes('91-img.com') && 
                (src.includes('gallery') || src.includes('pictures'))) {
                images.gallery.push({
                    index: images.gallery.length + 1,
                    url: src,
                    alt: cleanText(alt),
                    type: 'gallery'
                });
                seenUrls.add(src);
            }
        });

        $('img').each((index, img) => {
            const $img = $(img);
            const src = $img.attr('src') || $img.attr('data-src');
            const alt = $img.attr('alt');
            
            if (src && 
                !seenUrls.has(src) &&
                !src.includes('sourceimg') &&
                !src.includes('icon') &&
                src.includes('91-img.com')) {
                
                images.other.push({
                    url: src,
                    alt: cleanText(alt),
                    type: 'other'
                });
                seenUrls.add(src);
            }
        });

    } catch (error) {
        console.error('Error extracting images:', error);
    }

    return images;
}

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { brandName, url, folderName } = req.body;

    if (!brandName || !url) {
        return res.status(400).json({ error: 'brandName and url required' });
    }

    try {
        // Fetch page
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract data
        const specs = extractSpecsFromHTML($);
        const images = extractImages($);

        if (Object.keys(specs.specs).length === 0) {
            return res.status(400).json({ error: 'No specs found on page' });
        }

        // Get or create brand
        const { data: brand } = await supabase
            .from('brands')
            .select('id')
            .eq('name', brandName)
            .single();

        let brandId;

        if (!brand) {
            const { data: newBrand } = await supabase
                .from('brands')
                .insert({
                    name: brandName,
                    display_name: brandName.replace('Phones', '')
                })
                .select()
                .single();
            brandId = newBrand.id;
        } else {
            brandId = brand.id;
        }

        // Create or update phone
        const { data: existingPhone } = await supabase
            .from('phones')
            .select('id')
            .eq('brand_id', brandId)
            .eq('folder_name', folderName || specs.metadata['Phone Name'])
            .single();

        let phoneId;

        if (existingPhone) {
            phoneId = existingPhone.id;
        } else {
            const { data: newPhone } = await supabase
                .from('phones')
                .insert({
                    brand_id: brandId,
                    folder_name: folderName || specs.metadata['Phone Name'],
                    name: specs.metadata['Phone Name'] || 'Unknown',
                    price: specs.metadata['Price'] || null,
                    release_date: specs.metadata['Release Date'] || null,
                    first_image: images.gallery[0]?.url || null
                })
                .select()
                .single();
            phoneId = newPhone.id;
        }

        // Delete and re-insert details
        await supabase.from('phone_details').delete().eq('phone_id', phoneId);

        await supabase.from('phone_details').insert({
            phone_id: phoneId,
            specs: specs.specs,
            metadata: specs.metadata,
            sources: ['91mobiles']
        });

        // Delete and re-insert images
        await supabase.from('phone_images').delete().eq('phone_id', phoneId);

        for (let i = 0; i < images.gallery.length; i++) {
            await supabase.from('phone_images').insert({
                phone_id: phoneId,
                image_url: images.gallery[i].url,
                alt_text: images.gallery[i].alt || specs.metadata['Phone Name'],
                image_type: 'gallery',
                image_index: i
            });
        }

        res.status(200).json({
            success: true,
            message: `${specs.metadata['Phone Name']} added successfully`,
            phone: {
                id: phoneId,
                name: specs.metadata['Phone Name'],
                specs: Object.keys(specs.specs).length,
                images: images.gallery.length
            }
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
}
