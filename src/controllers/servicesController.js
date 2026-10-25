import { z } from 'zod';
import { query } from '../config/db.js';
import { ApiError } from '../middleware/errorHandler.js';
import { escapeHtml, escapeLike } from '../utils/escape.js';

// --- اسکیماها ---
const sideEffectSchema = z.object({
  title: z.string().trim().min(1, 'عنوان عارضه الزامی است').max(190),
  description: z.string().trim().max(1000).default(''),
});

const faqSchema = z.object({
  question: z.string().trim().min(1, 'سؤال الزامی است').max(300),
  answer: z.string().trim().min(1, 'پاسخ الزامی است').max(2000),
});

export const serviceSchema = z.object({
  title: z.string().trim().min(2, 'عنوان را وارد کنید').max(190),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'اسلاگ فقط حروف کوچک انگلیسی، عدد و خط تیره باشد')
    .max(190),
  category: z.string().trim().max(100).default(''),
  shortDescription: z.string().trim().max(500).default(''),
  description: z.string().trim().max(20000).default(''),
  coverImage: z.string().trim().max(255).default(''),
  duration: z.string().trim().max(100).default(''),
  recoveryTime: z.string().trim().max(190).default(''),
  sideEffects: z.array(sideEffectSchema).max(50).default([]),
  faqs: z.array(faqSchema).max(50).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000000).default(0),
});

export const serviceUpdateSchema = serviceSchema.partial();

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('شناسه نامعتبر است'),
});

export const adminListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** تبدیل ورودی به ردیف دیتابیس با escape متن‌ها */
function toRow(d) {
  return {
    title: escapeHtml(d.title),
    slug: d.slug,
    category: escapeHtml(d.category),
    short_description: escapeHtml(d.shortDescription),
    description: escapeHtml(d.description),
    cover_image: d.coverImage,
    duration: escapeHtml(d.duration),
    recovery_time: escapeHtml(d.recoveryTime),
    side_effects: JSON.stringify(
      (d.sideEffects || []).map((s) => ({
        title: escapeHtml(s.title),
        description: escapeHtml(s.description || ''),
      }))
    ),
    faqs: JSON.stringify(
      (d.faqs || []).map((f) => ({
        question: escapeHtml(f.question),
        answer: escapeHtml(f.answer),
      }))
    ),
    is_active: d.isActive ? 1 : 0,
    sort_order: d.sortOrder,
  };
}

/** GET /api/admin/services */
export async function listServices(req, res, next) {
  try {
    const { search, category, page, limit } = req.query;
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push('(title LIKE ? OR slug LIKE ?)');
      const like = `%${escapeLike(search)}%`;
      params.push(like, like);
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [{ total }] = await query(
      `SELECT COUNT(*) AS total FROM services ${where}`,
      params
    );
    const rows = await query(
      `SELECT id, title, slug, category, short_description, cover_image,
              duration, is_active, sort_order, created_at, updated_at
       FROM services ${where}
       ORDER BY sort_order ASC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    res.json({ success: true, message: 'ok', data: { items: rows, total, page, limit } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/services/:id */
export async function getService(req, res, next) {
  try {
    const rows = await query('SELECT * FROM services WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows.length) throw new ApiError(404, 'خدمت یافت نشد');
    res.json({ success: true, message: 'ok', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/services */
export async function createService(req, res, next) {
  try {
    const r = toRow(req.body);
    let result;
    try {
      result = await query(
        `INSERT INTO services
         (title, slug, category, short_description, description, cover_image,
          duration, recovery_time, side_effects, faqs, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.title, r.slug, r.category, r.short_description, r.description,
          r.cover_image, r.duration, r.recovery_time, r.side_effects, r.faqs,
          r.is_active, r.sort_order,
        ]
      );
    } catch (dbErr) {
      if (dbErr.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'اسلاگ تکراری است');
      throw dbErr;
    }
    const rows = await query('SELECT * FROM services WHERE id = ? LIMIT 1', [result.insertId]);
    res.status(201).json({ success: true, message: 'خدمت ایجاد شد', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/admin/services/:id */
export async function updateService(req, res, next) {
  try {
    const current = (await query('SELECT * FROM services WHERE id = ? LIMIT 1', [req.params.id]))[0];
    if (!current) throw new ApiError(404, 'خدمت یافت نشد');

    // فقط فیلدهای ارسال‌شده escape و تبدیل می‌شوند؛ فیلدهای ارسال‌نشده مستقیماً از مقدار
    // فعلی دیتابیس (که قبلاً escape شده) خوانده می‌شوند تا دوباره escape نشوند.
    const b = req.body;
    const r = {
      title: b.title !== undefined ? escapeHtml(b.title) : current.title,
      slug: b.slug !== undefined ? b.slug : current.slug,
      category: b.category !== undefined ? escapeHtml(b.category) : current.category,
      short_description:
        b.shortDescription !== undefined ? escapeHtml(b.shortDescription) : current.short_description,
      description: b.description !== undefined ? escapeHtml(b.description) : current.description || '',
      cover_image: b.coverImage !== undefined ? b.coverImage : current.cover_image,
      duration: b.duration !== undefined ? escapeHtml(b.duration) : current.duration,
      recovery_time: b.recoveryTime !== undefined ? escapeHtml(b.recoveryTime) : current.recovery_time,
      side_effects: JSON.stringify(
        b.sideEffects !== undefined
          ? b.sideEffects.map((s) => ({ title: escapeHtml(s.title), description: escapeHtml(s.description || '') }))
          : current.side_effects || []
      ),
      faqs: JSON.stringify(
        b.faqs !== undefined
          ? b.faqs.map((f) => ({ question: escapeHtml(f.question), answer: escapeHtml(f.answer) }))
          : current.faqs || []
      ),
      is_active: b.isActive !== undefined ? (b.isActive ? 1 : 0) : current.is_active,
      sort_order: b.sortOrder !== undefined ? b.sortOrder : current.sort_order,
    };

    try {
      await query(
        `UPDATE services SET title=?, slug=?, category=?, short_description=?, description=?,
                cover_image=?, duration=?, recovery_time=?, side_effects=?, faqs=?,
                is_active=?, sort_order=?
         WHERE id = ?`,
        [
          r.title, r.slug, r.category, r.short_description, r.description,
          r.cover_image, r.duration, r.recovery_time, r.side_effects, r.faqs,
          r.is_active, r.sort_order, req.params.id,
        ]
      );
    } catch (dbErr) {
      if (dbErr.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'اسلاگ تکراری است');
      throw dbErr;
    }

    const rows = await query('SELECT * FROM services WHERE id = ? LIMIT 1', [req.params.id]);
    res.json({ success: true, message: 'خدمت به‌روزرسانی شد', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/services/:id — نمونه‌های قبل/بعد هم CASCADE حذف می‌شوند */
export async function deleteService(req, res, next) {
  try {
    const result = await query('DELETE FROM services WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) throw new ApiError(404, 'خدمت یافت نشد');
    res.json({ success: true, message: 'خدمت حذف شد', data: null });
  } catch (err) {
    next(err);
  }
}
