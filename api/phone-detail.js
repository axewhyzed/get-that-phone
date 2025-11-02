import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { id } = req.query;

    try {
        const { data: details, error: detailError } = await supabase
            .from('phone_details')
            .select('*')
            .eq('phone_id', id)
            .single();

        const { data: images, error: imageError } = await supabase
            .from('phone_images')
            .select('*')
            .eq('phone_id', id)
            .order('image_type', { ascending: true })
            .order('image_index', { ascending: true });

        if (detailError) throw detailError;
        if (imageError) throw imageError;

        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.status(200).json({
            ...details,
            images: images
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
