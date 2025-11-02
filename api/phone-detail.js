import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

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

        res.status(200).json({
            ...details,
            images: images
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
