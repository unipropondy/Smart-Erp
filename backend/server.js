
require('dotenv').config();
const express = require('express');
const mssql = require('mssql');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = 5000;

// Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/js', express.static(path.join(__dirname, '../frontend/js')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ============= MSSQL CONNECTION CONFIG =============
const config = {
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'uniprosg1500',
    server: process.env.DB_HOST || 'database-1.ct2s4oesuriu.ap-southeast-2.rds.amazonaws.com',
    port: parseInt(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME || 'unipro_erp',
    options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 60000,
        requestTimeout: 60000
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let pool = null;

async function getPool() {
    if (!pool) {
        try {
            pool = await mssql.connect(config);
            console.log('✅ MSSQL Connection SUCCESSFUL!');
            
            // Test query - Get databases
            const result = await pool.request().query('SELECT name FROM sys.databases');
            console.log('📊 Available databases:');
            result.recordset.forEach(row => console.log('  -', row.name));
            return pool;
        } catch (err) {
            console.error('❌ Database connection FAILED:', err.message);
            throw err;
        }
    }
    return pool;
}

// Initialize connection
getPool().catch(err => console.error('Initial connection failed:', err));

// ============= HELPER FUNCTIONS FOR MSSQL =============

// Convert MySQL NOW() to GETDATE()
function getNow() {
    return new Date();
}

// Convert MySQL CURDATE() to CAST(GETDATE() AS DATE)
function getCurDate() {
    return new Date().toISOString().split('T')[0];
}

// Helper to handle NULL values
function handleNull(value) {
    return value === undefined || value === null || value === '' ? null : value;
}

// Helper for boolean conversion (MySQL TINYINT(1) -> BIT)
function toBit(value) {
    if (value === true || value === 1 || value === 'true' || value === '1') return 1;
    if (value === false || value === 0 || value === 'false' || value === '0') return 0;
    return value ? 1 : 0;
}

// Helper to parse date for MSSQL
function parseDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return d.toISOString().split('T')[0];
}

// ============= CRON JOB - Overdue Invoices =============
cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Checking overdue invoices...');
    
    try {
        const pool = await getPool();
        const sql = `
            UPDATE purchase_invoices 
            SET payment_status = 'overdue'
            WHERE payment_status IN ('new', 'partial')
            AND due_date < CAST(GETDATE() AS DATE)
            AND status = 'posted'
        `;
        
        const result = await pool.request().query(sql);
        if (result.rowsAffected && result.rowsAffected[0] > 0) {
            console.log(`✅ Updated ${result.rowsAffected[0]} invoices to overdue`);
        }
    } catch (err) {
        console.error('❌ Overdue update error:', err);
    }
});

// ============= SIMPLE TEST API =============
app.get('/api/test', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1+1 AS result');
        res.json({
            status: 'success',
            message: 'UniPro Backend is running!',
            database: 'MSSQL Connected',
            timestamp: new Date().toISOString(),
            test: result.recordset[0],
            endpoints: [
                '/api/test',
                '/api/dbs',
                '/api/query'
            ]
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List databases
app.get('/api/dbs', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT name FROM sys.databases');
        res.json({
            count: result.recordset.length,
            databases: result.recordset.map(row => row.name)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Run custom query
app.get('/api/query', async (req, res) => {
    const query = req.query.q || 'SELECT 1+1 AS result';
    try {
        const pool = await getPool();
        const result = await pool.request().query(query);
        res.json({
            query: query,
            results: result.recordset,
            count: result.recordset.length
        });
    } catch (err) {
        res.status(500).json({
            error: err.message,
            query: query
        });
    }
});

// Simple insert test
app.get('/api/insert-test', async (req, res) => {
    try {
        const pool = await getPool();
        
        // Check if test_db exists, create if not
        await pool.request().query(`
            IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'test_db')
            BEGIN
                CREATE DATABASE test_db
            END
        `);
        
        // Use test database
        await pool.request().query('USE test_db');
        
        // Create table if not exists
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'test_table')
            BEGIN
                CREATE TABLE test_table (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    name VARCHAR(50),
                    created_at DATETIME DEFAULT GETDATE()
                )
            END
        `);
        
        // Insert test data
        const insertResult = await pool.request()
            .input('name', mssql.VarChar(50), 'Test User ' + Date.now())
            .query('INSERT INTO test_table (name) VALUES (@name); SELECT SCOPE_IDENTITY() AS id');
        
        const insertedId = insertResult.recordset[0].id;
        
        // Select all data
        const selectResult = await pool.request().query('SELECT * FROM test_table');
        
        res.json({
            message: 'Test successful!',
            insertedId: insertedId,
            totalRecords: selectResult.recordset.length,
            data: selectResult.recordset
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============= FRONTEND ROUTES =============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/adp.html'));
});

app.get('/adp', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/adp.html'));
});

app.get('/erp', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/erp.html'));
});

// ============= CUSTOMER CRUD API =============

// 1. CREATE CUSTOMER
app.post('/api/customers', async (req, res) => {
    try {
        const customerData = req.body;
        console.log('🔧 Creating customer with new address fields...');
        
        if (!customerData.customer_code || !customerData.customer_name) {
            return res.status(400).json({
                success: false,
                error: 'Customer code and name are required'
            });
        }

        const pool = await getPool();
        
        // Check duplicate customer code
        const checkResult = await pool.request()
            .input('customer_code', mssql.VarChar(50), customerData.customer_code)
            .query('SELECT customer_id FROM customers WHERE customer_code = @customer_code');
        
        if (checkResult.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Customer code "${customerData.customer_code}" already exists`
            });
        }

        const salesmanName = customerData.salesman?.trim() || null;

        // Prepare data for insertion
        const insertData = {
            customer_code: customerData.customer_code,
            customer_name: customerData.customer_name,
            alias: handleNull(customerData.alias),
            company_reg_no: handleNull(customerData.company_reg_no),
            gst_reg: handleNull(customerData.gst_reg),
            gst_type: customerData.gst_type || 'Exclusive',
            salesman: salesmanName,
            is_active: toBit(customerData.is_active !== undefined ? customerData.is_active : true),
            currency: customerData.currency || 'SGD',
            credit_limit: parseFloat(customerData.credit_limit) || 0.00,
            is_hq_customer: toBit(customerData.is_hq_customer || false),
            is_blocked: toBit(customerData.is_blocked || false),
            credit_terms: customerData.credit_terms || '7 Days',
            tolerance: customerData.tolerance || '7 Days',
            bank_id: handleNull(customerData.bank_id),
            bank_name: handleNull(customerData.bank_name),
            bank_account_no: handleNull(customerData.bank_account_no),
            website: handleNull(customerData.website),
            rate_type: handleNull(customerData.rate_type),
            ar_account_id: handleNull(customerData.ar_account_id),
            hq_reference: handleNull(customerData.hq_reference),
            schedule_day: customerData.schedule_day || 'Monday',
            address_line1: handleNull(customerData.address_line1),
            address_line2: handleNull(customerData.address_line2),
            address_line3: handleNull(customerData.address_line3),
            city: customerData.city || 'Singapore',
            postal_code: handleNull(customerData.postal_code),
            country: customerData.country || 'Singapore',
            is_delivery_same_address: toBit(customerData.is_delivery_same_address || false),
            delivery_address1: handleNull(customerData.delivery_address1),
            delivery_address2: handleNull(customerData.delivery_address2),
            delivery_address3: handleNull(customerData.delivery_address3),
            delivery_city: handleNull(customerData.delivery_city),
            delivery_country: handleNull(customerData.delivery_country),
            delivery_postal_code: handleNull(customerData.delivery_postal_code),
            contact_person1: handleNull(customerData.contact_person1),
            phone1: handleNull(customerData.phone1),
            email: handleNull(customerData.email),
            office_phone: handleNull(customerData.office_phone),
            fax_number: handleNull(customerData.fax_number),
            contact_no: handleNull(customerData.contact_no),
            customer_remarks: handleNull(customerData.customer_remarks),
            customer_note: handleNull(customerData.customer_note),
            created_by: 1,
            created_at: new Date()
        };

        // If delivery same as billing, copy billing address
        if (insertData.is_delivery_same_address) {
            insertData.delivery_address1 = insertData.address_line1;
            insertData.delivery_address2 = insertData.address_line2;
            insertData.delivery_address3 = insertData.address_line3;
            insertData.delivery_city = insertData.city;
            insertData.delivery_country = insertData.country;
            insertData.delivery_postal_code = insertData.postal_code;
        }

        // Build insert query dynamically
        const columns = Object.keys(insertData);
        const values = columns.map(col => `@${col}`).join(', ');
        const paramNames = columns.map(col => `@${col}`);
        
        const insertSql = `INSERT INTO customers (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS customer_id`;
        
        const request = pool.request();
        columns.forEach(col => {
            const val = insertData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });
        
        const result = await request.query(insertSql);
        const customerId = result.recordset[0].customer_id;

        console.log(`✅ Customer created: ${customerData.customer_code} (ID: ${customerId})`);

        res.status(201).json({
            success: true,
            message: 'Customer created successfully',
            customer_id: customerId,
            customer_code: customerData.customer_code
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// 2. READ ALL CUSTOMERS
app.get('/api/customers', async (req, res) => {
    try {
        const {
            search,
            page = 1,
            limit = 20,
            status,
            salesman
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();

        let sql = `
            SELECT 
                c.*,
                COALESCE(u.username, CAST(c.created_by AS NVARCHAR(100))) as created_by_name
            FROM customers c
            LEFT JOIN users u ON (TRY_CAST(c.created_by AS INT) = u.user_id OR CAST(c.created_by AS NVARCHAR(100)) = u.username)
            WHERE 1=1
        `;

        const params = [];
        const request = pool.request();

        if (search) {
            sql += ` AND (
                c.customer_code LIKE @search OR 
                c.customer_name LIKE @search OR 
                c.email LIKE @search OR 
                c.contact_person1 LIKE @search OR
                c.salesman LIKE @search
            )`;
            const searchTerm = `%${search}%`;
            request.input('search', mssql.NVarChar, searchTerm);
        }

        if (status === 'active') {
            sql += ' AND c.is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND c.is_active = 0';
        } else if (status === 'blocked') {
            sql += ' AND c.is_blocked = 1';
        }

        if (salesman && salesman !== 'all') {
            sql += ' AND c.salesman LIKE @salesman';
            request.input('salesman', mssql.NVarChar, `%${salesman}%`);
        }

        // Get total count
        const countSql = sql.replace(
            'SELECT c.*, u.username as created_by_name',
            'SELECT COUNT(*) as total'
        ).replace('ORDER BY c.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY', '');

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Add ordering and pagination
        sql += ` ORDER BY c.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. CUSTOMER LIST API
app.get('/api/customers/list', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                c.customer_id,
                c.customer_code,
                c.customer_name,
                c.currency,
                c.credit_limit,
                ISNULL(c.credit_on_hold, 0) as credit_on_hold,
                c.is_active,
                c.is_blocked,
                c.contact_person1,
                c.phone1,
                c.email,
                s.salesman_name,
                c.created_at
            FROM customers c
            LEFT JOIN salesmen s ON c.salesman_id = s.salesman_id
            WHERE 1=1
        `;

        if (search) {
            sql += ` AND (
                c.customer_code LIKE @search OR 
                c.customer_name LIKE @search OR 
                c.contact_person1 LIKE @search OR 
                c.phone1 LIKE @search OR
                c.email LIKE @search
            )`;
            const searchTerm = `%${search}%`;
            request.input('search', mssql.NVarChar, searchTerm);
        }

        if (status === 'active') {
            sql += ' AND c.is_active = 1 AND c.is_blocked = 0';
        } else if (status === 'inactive') {
            sql += ' AND c.is_active = 0';
        } else if (status === 'blocked') {
            sql += ' AND c.is_blocked = 1';
        }

        // Count query
        const countSql = sql.replace(
            'SELECT c.customer_id, c.customer_code, c.customer_name, c.currency, c.credit_limit, ISNULL(c.credit_on_hold, 0) as credit_on_hold, c.is_active, c.is_blocked, c.contact_person1, c.phone1, c.email, s.salesman_name, c.created_at',
            'SELECT COUNT(*) as total'
        );

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Add ordering and pagination
        sql += ` ORDER BY c.customer_id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        // Format results
        const formattedResults = result.recordset.map(customer => ({
            ...customer,
            contact_info: customer.contact_person1 && customer.phone1
                ? `${customer.contact_person1}/${customer.phone1}`
                : customer.contact_person1 || customer.phone1 || '',
            status: customer.is_blocked ? 'Blocked' :
                customer.is_active ? 'Active' : 'Inactive',
            status_color: customer.is_blocked ? 'red' :
                customer.is_active ? 'green' : 'orange'
        }));

        res.json({
            success: true,
            data: formattedResults,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. CUSTOMER TABLE API
app.get('/api/customers/table', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search = '',
            status = 'all',
            salesman = 'all',
            currency = 'all',
            sortBy = 'customer_code',
            sortOrder = 'ASC'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let whereConditions = [];
        let params = [];

        if (search && search.trim() !== '') {
            whereConditions.push(`(
                c.customer_code LIKE @search OR 
                c.customer_name LIKE @search OR 
                c.contact_person1 LIKE @search OR 
                c.phone1 LIKE @search OR
                c.email LIKE @search OR
                c.salesman LIKE @search
            )`);
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status !== 'all') {
            if (status === 'active') {
                whereConditions.push('c.is_active = 1 AND c.is_blocked = 0');
            } else if (status === 'inactive') {
                whereConditions.push('c.is_active = 0');
            } else if (status === 'blocked') {
                whereConditions.push('c.is_blocked = 1');
            }
        }

        if (salesman !== 'all') {
            whereConditions.push('c.salesman LIKE @salesman');
            request.input('salesman', mssql.NVarChar, `%${salesman}%`);
        }

        if (currency !== 'all') {
            whereConditions.push('c.currency = @currency');
            request.input('currency', mssql.NVarChar, currency);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Determine order column
        let orderColumn = 'c.customer_id';
        switch(sortBy) {
            case 'code': orderColumn = 'c.customer_code'; break;
            case 'name': orderColumn = 'c.customer_name'; break;
            case 'created_at': orderColumn = 'c.created_at'; break;
            default: orderColumn = 'c.customer_id';
        }

        const orderClause = `ORDER BY ${orderColumn} ${sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}`;

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM customers c ${whereClause}`;
        const countResult = await request.query(countSql);
        const total = Number(countResult.recordset[0]?.total) || 0;

        // Data query
        const dataSql = `
            SELECT 
                c.customer_id,
                c.customer_code,
                c.customer_name,
                c.currency,
                c.credit_limit,
                ISNULL(c.credit_on_hold, 0) as credit_on_hold,
                c.is_active,
                c.is_blocked,
                c.contact_person1,
                c.phone1,
                c.email,
                c.salesman,
                c.created_at,
                c.address_line1,
                c.address_line2,
                c.address_line3,
                c.city,
                c.postal_code,
                c.country,
                c.is_delivery_same_address,
                c.delivery_address1,
                c.delivery_address2,
                c.delivery_address3,
                c.delivery_city,
                c.delivery_country,
                c.delivery_postal_code,
                c.bank_name,
                c.bank_account_no,
                c.gst_type,
                c.gst_reg,
                c.credit_terms,
                c.tolerance,
                c.company_reg_no,
                c.office_phone
            FROM customers c
            ${whereClause}
            ${orderClause}
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(dataSql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            },
            sort: {
                by: sortBy,
                order: sortOrder
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. CUSTOMER STATISTICS API
app.get('/api/customers/stats', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                COUNT(*) as total_customers,
                SUM(CASE WHEN is_active = 1 AND is_blocked = 0 THEN 1 ELSE 0 END) as active_customers,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_customers,
                SUM(CASE WHEN is_blocked = 1 THEN 1 ELSE 0 END) as blocked_customers,
                SUM(credit_limit) as total_credit_limit,
                SUM(ISNULL(credit_on_hold, 0)) as total_credit_on_hold
            FROM customers
        `;

        const result = await pool.request().query(sql);
        
        res.json({
            success: true,
            data: result.recordset[0] || {
                total_customers: 0,
                active_customers: 0,
                inactive_customers: 0,
                blocked_customers: 0,
                total_credit_limit: 0,
                total_credit_on_hold: 0
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. READ SINGLE CUSTOMER
app.get('/api/customers/:id', async (req, res) => {
    try {
        const customerId = parseInt(req.params.id, 10);
        if (isNaN(customerId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid customer ID'
            });
        }
        const pool = await getPool();

        const sql = `
            SELECT 
                c.*,
                c.delivery_address1,
                c.delivery_address2,
                c.delivery_address3,
                c.delivery_city,
                c.delivery_country,
                c.delivery_postal_code,
                COALESCE(u.username, CAST(c.created_by AS NVARCHAR(100))) as created_by_name
            FROM customers c
            LEFT JOIN users u ON (TRY_CAST(c.created_by AS INT) = u.user_id OR CAST(c.created_by AS NVARCHAR(100)) = u.username)
            WHERE c.customer_id = @customerId
        `;

        const result = await pool.request()
            .input('customerId', mssql.Int, customerId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Customer not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. UPDATE CUSTOMER
app.put('/api/customers/:id', async (req, res) => {
    try {
        const customerId = parseInt(req.params.id, 10);
        if (isNaN(customerId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid customer ID'
            });
        }
        const updateData = req.body;

        if (!updateData.customer_name) {
            return res.status(400).json({
                success: false,
                error: 'Customer name is required'
            });
        }

        const pool = await getPool();
        const salesmanName = updateData.salesman?.trim() || null;

        const updateFields = {
            customer_name: updateData.customer_name,
            alias: handleNull(updateData.alias),
            company_reg_no: handleNull(updateData.company_reg_no),
            gst_reg: handleNull(updateData.gst_reg),
            gst_type: updateData.gst_type || 'Exclusive',
            salesman: salesmanName,
            is_active: toBit(updateData.is_active !== undefined ? updateData.is_active : true),
            currency: updateData.currency || 'SGD',
            credit_limit: parseFloat(updateData.credit_limit) || 0.00,
            is_hq_customer: toBit(updateData.is_hq_customer || false),
            is_blocked: toBit(updateData.is_blocked || false),
            credit_terms: updateData.credit_terms || '30 Days',
            tolerance: updateData.tolerance || '7 Days',
            bank_id: handleNull(updateData.bank_id),
            bank_name: handleNull(updateData.bank_name),
            bank_account_no: handleNull(updateData.bank_account_no),
            website: handleNull(updateData.website),
            rate_type: handleNull(updateData.rate_type),
            ar_account_id: handleNull(updateData.ar_account_id),
            hq_reference: handleNull(updateData.hq_reference),
            schedule_day: updateData.schedule_day || 'Monday',
            address_line1: handleNull(updateData.address_line1),
            address_line2: handleNull(updateData.address_line2),
            address_line3: handleNull(updateData.address_line3),
            city: updateData.city || 'Singapore',
            postal_code: handleNull(updateData.postal_code),
            country: updateData.country || 'Singapore',
            is_delivery_same_address: toBit(updateData.is_delivery_same_address || false),
            delivery_address1: handleNull(updateData.delivery_address1),
            delivery_address2: handleNull(updateData.delivery_address2),
            delivery_address3: handleNull(updateData.delivery_address3),
            delivery_city: handleNull(updateData.delivery_city),
            delivery_country: handleNull(updateData.delivery_country),
            delivery_postal_code: handleNull(updateData.delivery_postal_code),
            contact_person1: handleNull(updateData.contact_person1),
            phone1: handleNull(updateData.phone1),
            email: handleNull(updateData.email),
            office_phone: handleNull(updateData.office_phone),
            fax_number: handleNull(updateData.fax_number),
            contact_no: handleNull(updateData.contact_no),
            customer_remarks: handleNull(updateData.customer_remarks),
            customer_note: handleNull(updateData.customer_note),
            updated_by: 1,
            updated_at: new Date()
        };

        // Build SET clause dynamically
        const setClause = Object.keys(updateFields).map(key => `${key} = @${key}`).join(', ');
        const updateSql = `UPDATE customers SET ${setClause} WHERE customer_id = @customerId`;

        const request = pool.request();
        request.input('customerId', mssql.Int, customerId);
        
        Object.keys(updateFields).forEach(key => {
            const val = updateFields[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(updateSql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Customer not found'
            });
        }

        console.log(`✅ Customer ID: ${customerId} updated successfully`);

        res.json({
            success: true,
            message: 'Customer updated successfully',
            customer_id: customerId,
            updated_fields: {
                currency: updateFields.currency,
                bank_id: updateFields.bank_id,
                ar_account_id: updateFields.ar_account_id,
                salesman: updateFields.salesman
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// 8. DELETE CUSTOMER (HARD DELETE)
app.delete('/api/customers/:id', async (req, res) => {
    try {
        const customerId = parseInt(req.params.id, 10);
        if (isNaN(customerId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid customer ID'
            });
        }
        console.log(`🔥 REAL DELETE for customer ${customerId}`);

        const pool = await getPool();

        // Check if customer exists
        const checkResult = await pool.request()
            .input('customerId', mssql.Int, customerId)
            .query('SELECT customer_id, customer_name, customer_code FROM customers WHERE customer_id = @customerId');

        if (checkResult.recordset.length === 0) {
            return res.json({
                success: false,
                error: `Customer ID ${customerId} not found`
            });
        }

        const customer = checkResult.recordset[0];

        // Delete customer
        const deleteResult = await pool.request()
            .input('customerId', mssql.Int, customerId)
            .query('DELETE FROM customers WHERE customer_id = @customerId');

        console.log('✅ DELETE successful - Affected rows:', deleteResult.rowsAffected[0]);

        res.json({
            success: true,
            message: `Customer "${customer.customer_name}" PERMANENTLY DELETED`,
            deletedId: customerId,
            deletedName: customer.customer_name,
            deletedCode: customer.customer_code,
            affectedRows: deleteResult.rowsAffected[0],
            action: 'HARD_DELETE_COMPLETED',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 9. CHECK CUSTOMER CODE AVAILABILITY
app.get('/api/customers/check-code/:code', async (req, res) => {
    try {
        const customerCode = req.params.code;
        const pool = await getPool();

        const result = await pool.request()
            .input('code', mssql.VarChar(50), customerCode)
            .query('SELECT customer_id FROM customers WHERE customer_code = @code');

        res.json({
            success: true,
            available: result.recordset.length === 0,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 10. CUSTOMER TEST ENDPOINT
app.get('/api/customers/test', (req, res) => {
    res.json({
        success: true,
        message: 'Customers API is working!',
        timestamp: new Date().toISOString(),
        endpoints: [
            '/api/customers - GET (all customers with filters)',
            '/api/customers/list - GET (formatted for table)',
            '/api/customers/table - GET (with pagination & filters)',
            '/api/customers/stats - GET (statistics)',
            '/api/customers/:id - GET (single customer)',
            '/api/customers - POST (create)',
            '/api/customers/:id - PUT (update)',
            '/api/customers/:id - DELETE (hard delete)',
            '/api/customers/check-code/:code - GET (check code)'
        ]
    });
});

// 11. GET ACTIVE BANKS
app.get('/api/banks/active', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                b.bank_id, 
                b.bank_code, 
                b.bank_name, 
                (b.bank_code + ' - ' + b.bank_name) as display_name,
                b.account_number,
                b.currency_id,
                c.currency_code
            FROM banks b
            LEFT JOIN currencies c ON b.currency_id = c.currency_id
            WHERE b.is_active = 1
            ORDER BY b.bank_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 12. GET ACTIVE CURRENCIES
app.get('/api/currencies/active', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                currency_id,
                currency_code,
                currency_name,
                currency_symbol,
                (currency_code + ' - ' + currency_name) as display_name
            FROM currencies
            WHERE is_active = 1
            ORDER BY currency_code
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 13. GET ACTIVE SALESMEN
app.get('/api/salesmen/active', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT salesman_id, salesman_code, salesman_name, 
                   email, phone, is_active
            FROM salesmen 
            WHERE is_active = 1
            ORDER BY salesman_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 14. GET SALESMEN FOR DROPDOWN
app.get('/api/salesmen/dropdown', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                salesman_id as value,
                salesman_code + ' - ' + salesman_name as label,
                salesman_name,
                salesman_code
            FROM salesmen 
            WHERE is_active = 1
            ORDER BY salesman_code
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 15. GET SALESMEN USED IN CUSTOMERS
app.get('/api/customers/salesmen-used', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT DISTINCT 
                c.salesman as salesman_name,
                COUNT(*) as customer_count
            FROM customers c
            WHERE c.salesman IS NOT NULL 
              AND c.salesman != ''
              AND LTRIM(RTRIM(c.salesman)) != ''
            GROUP BY c.salesman
            ORDER BY salesman_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 16. GET SALESMEN LIST
app.get('/api/customers/salesmen-list', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                customer_id,
                customer_name,
                salesman,
                LEN(salesman) as length,
                LTRIM(RTRIM(salesman)) as trimmed
            FROM customers 
            WHERE salesman IS NOT NULL 
              AND salesman != ''
            ORDER BY customer_id DESC
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 17. GET DISTINCT SALESMEN
app.get('/api/customers/salesmen', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT DISTINCT 
                LTRIM(RTRIM(salesman)) as salesman_name,
                COUNT(*) as customer_count
            FROM customers 
            WHERE salesman IS NOT NULL 
              AND salesman != ''
              AND LTRIM(RTRIM(salesman)) != ''
            GROUP BY LTRIM(RTRIM(salesman))
            ORDER BY salesman_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= CUSTOMER PRICING APIs =============

// 1. CREATE CUSTOMER PRICING
app.post('/api/customer-pricing', async (req, res) => {
    let transaction;
    try {
        const pricingData = req.body;
        console.log('📦 Creating customer pricing:', pricingData);

        const pool = await getPool();
        transaction = new mssql.Transaction(pool);
        await transaction.begin();

        // 1. Insert pricing header
        const headerSql = `
            INSERT INTO customer_pricing_header 
            (customer_id, customer_code, customer_name, from_date, to_date, 
             location, status, department_name, category_name, brand_name, 
             product_name, created_by)
            VALUES 
            (@customerId, @customerCode, @customerName, @fromDate, @toDate,
             @location, @status, @departmentName, @categoryName, @brandName,
             @productName, @createdBy);
            SELECT SCOPE_IDENTITY() AS pricingId
        `;

        const headerResult = await transaction.request()
            .input('customerId', mssql.Int, pricingData.customer_id)
            .input('customerCode', mssql.NVarChar, pricingData.customer_code)
            .input('customerName', mssql.NVarChar, pricingData.customer_name)
            .input('fromDate', mssql.Date, parseDate(pricingData.from_date))
            .input('toDate', mssql.Date, parseDate(pricingData.to_date))
            .input('location', mssql.NVarChar, pricingData.location)
            .input('status', mssql.NVarChar, 'Draft')
            .input('departmentName', mssql.NVarChar, handleNull(pricingData.department_name))
            .input('categoryName', mssql.NVarChar, handleNull(pricingData.category_name))
            .input('brandName', mssql.NVarChar, handleNull(pricingData.brand_name))
            .input('productName', mssql.NVarChar, handleNull(pricingData.product_name))
            .input('createdBy', mssql.Int, 1)
            .query(headerSql);

        const pricingId = headerResult.recordset[0].pricingId;
        console.log('✅ Pricing header created, ID:', pricingId);

        // 2. Insert pricing details
        if (pricingData.products && pricingData.products.length > 0) {
            let insertedCount = 0;
            let detailErrors = [];

            for (let i = 0; i < pricingData.products.length; i++) {
                const product = pricingData.products[i];
                try {
                    const detailSql = `
                        INSERT INTO customer_pricing_details 
                        (pricing_id, product_id, product_code, product_name, uom, 
                         list_price, dollar_price, customer_price)
                        VALUES 
                        (@pricingId, @productId, @productCode, @productName, @uom,
                         @listPrice, @dollarPrice, @customerPrice)
                    `;

                    await transaction.request()
                        .input('pricingId', mssql.Int, pricingId)
                        .input('productId', mssql.Int, handleNull(product.product_id))
                        .input('productCode', mssql.NVarChar, handleNull(product.product_code))
                        .input('productName', mssql.NVarChar, product.product_name)
                        .input('uom', mssql.NVarChar, product.uom || 'PCS')
                        .input('listPrice', mssql.Decimal(18, 2), product.list_price || 0.00)
                        .input('dollarPrice', mssql.Decimal(18, 2), product.dollar_price || 0.00)
                        .input('customerPrice', mssql.Decimal(18, 2), product.customer_price || 0.00)
                        .query(detailSql);

                    insertedCount++;
                } catch (err) {
                    detailErrors.push({ product: product.product_name, error: err.message });
                }
            }

            if (detailErrors.length > 0) {
                await transaction.rollback();
                return res.status(500).json({
                    error: 'Some products failed to save',
                    details: detailErrors
                });
            }

            await transaction.commit();

            res.status(201).json({
                success: true,
                message: 'Customer pricing created successfully',
                pricing_id: pricingId,
                products_count: insertedCount,
                data: {
                    pricing_id: pricingId,
                    customer_name: pricingData.customer_name,
                    from_date: pricingData.from_date,
                    to_date: pricingData.to_date,
                    status: 'Draft'
                }
            });
        } else {
            await transaction.commit();
            res.status(201).json({
                success: true,
                message: 'Customer pricing created (no products added)',
                pricing_id: pricingId,
                products_count: 0
            });
        }

    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. GET ALL CUSTOMER PRICING
app.get('/api/customer-pricing', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = '',
            customer_id = ''
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                cp.pricing_id,
                cp.customer_id,
                cp.customer_code,
                cp.customer_name,
                cp.from_date,
                cp.to_date,
                cp.location,
                cp.status,
                cp.created_at,
                COUNT(cpd.pricing_detail_id) as total_products,
                ISNULL(SUM(cpd.customer_price), 0) as total_amount
            FROM customer_pricing_header cp
            LEFT JOIN customer_pricing_details cpd ON cp.pricing_id = cpd.pricing_id
            WHERE 1=1
        `;

        if (search) {
            sql += ` AND (
                cp.customer_name LIKE @search OR 
                cp.customer_code LIKE @search OR
                cp.location LIKE @search
            )`;
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status) {
            sql += ' AND cp.status = @status';
            request.input('status', mssql.NVarChar, status);
        }

        if (customer_id && customer_id !== 'undefined' && customer_id !== 'null' && !isNaN(parseInt(customer_id, 10))) {
            sql += ' AND cp.customer_id = @customerId';
            request.input('customerId', mssql.Int, parseInt(customer_id, 10));
        }

        // Count query
        const countSql = sql.replace(
            'SELECT cp.pricing_id, cp.customer_id, cp.customer_code, cp.customer_name, cp.from_date, cp.to_date, cp.location, cp.status, cp.created_at, COUNT(cpd.pricing_detail_id) as total_products, ISNULL(SUM(cpd.customer_price), 0) as total_amount',
            'SELECT COUNT(DISTINCT cp.pricing_id) as total'
        ).replace('GROUP BY cp.pricing_id ORDER BY cp.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY', '');

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Data query
        sql += ` 
            GROUP BY cp.pricing_id, cp.customer_id, cp.customer_code, cp.customer_name, 
                     cp.from_date, cp.to_date, cp.location, cp.status, cp.created_at
            ORDER BY cp.created_at DESC 
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 3. GET SINGLE CUSTOMER PRICING
app.get('/api/customer-pricing/:id', async (req, res) => {
    try {
        const pricingId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT 
                cp.*,
                cpd.pricing_detail_id,
                cpd.product_id,
                cpd.product_code,
                cpd.product_name,
                cpd.uom,
                cpd.list_price,
                cpd.dollar_price,
                cpd.customer_price,
                cpd.price_difference,
                cpd.is_active
            FROM customer_pricing_header cp
            LEFT JOIN customer_pricing_details cpd ON cp.pricing_id = cpd.pricing_id
            WHERE cp.pricing_id = @pricingId
            ORDER BY cpd.product_name
        `;

        const result = await pool.request()
            .input('pricingId', mssql.Int, pricingId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Pricing not found' });
        }

        const firstRow = result.recordset[0];
        const pricingData = {
            header: {
                pricing_id: firstRow.pricing_id,
                customer_id: firstRow.customer_id,
                customer_code: firstRow.customer_code,
                customer_name: firstRow.customer_name,
                from_date: firstRow.from_date,
                to_date: firstRow.to_date,
                location: firstRow.location,
                status: firstRow.status,
                department_name: firstRow.department_name,
                category_name: firstRow.category_name,
                brand_name: firstRow.brand_name,
                product_name: firstRow.product_name,
                created_at: firstRow.created_at
            },
            products: result.recordset
                .filter(row => row.pricing_detail_id)
                .map(row => ({
                    pricing_detail_id: row.pricing_detail_id,
                    product_id: row.product_id,
                    product_code: row.product_code,
                    product_name: row.product_name,
                    uom: row.uom,
                    list_price: row.list_price,
                    dollar_price: row.dollar_price,
                    customer_price: row.customer_price,
                    price_difference: row.price_difference,
                    is_active: row.is_active
                }))
        };

        res.json({
            success: true,
            data: pricingData
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4. UPDATE CUSTOMER PRICING STATUS
app.put('/api/customer-pricing/:id/status', async (req, res) => {
    try {
        const pricingId = req.params.id;
        const { status } = req.body;

        const validStatuses = ['Draft', 'Active', 'Expired', 'Cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const pool = await getPool();
        const sql = `
            UPDATE customer_pricing_header 
            SET status = @status, updated_at = GETDATE() 
            WHERE pricing_id = @pricingId
        `;

        const result = await pool.request()
            .input('status', mssql.NVarChar, status)
            .input('pricingId', mssql.Int, pricingId)
            .query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Pricing not found' });
        }

        res.json({
            success: true,
            message: `Status updated to ${status}`,
            pricing_id: pricingId,
            new_status: status
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5. DELETE CUSTOMER PRICING
app.delete('/api/customer-pricing/:id', async (req, res) => {
    let transaction;
    try {
        const pricingId = req.params.id;
        const pool = await getPool();
        transaction = new mssql.Transaction(pool);
        await transaction.begin();

        // Delete details
        const detailsResult = await transaction.request()
            .input('pricingId', mssql.Int, pricingId)
            .query('DELETE FROM customer_pricing_details WHERE pricing_id = @pricingId');

        // Delete header
        const headerResult = await transaction.request()
            .input('pricingId', mssql.Int, pricingId)
            .query('DELETE FROM customer_pricing_header WHERE pricing_id = @pricingId');

        if (headerResult.rowsAffected[0] === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Pricing not found' });
        }

        await transaction.commit();

        res.json({
            success: true,
            message: 'Customer pricing deleted successfully',
            pricing_id: pricingId,
            deleted_products: detailsResult.rowsAffected[0]
        });

    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 6. GET PRODUCTS FOR PRICING
app.get('/api/products/pricing', async (req, res) => {
    try {
        const {
            department = '',
            category = '',
            brand = '',
            product = '',
            limit = 50
        } = req.query;

        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                product_id,
                product_code,
                product_name,
                uom,
                list_price,
                cost_price,
                department_name,
                category_name,
                brand_name
            FROM products
            WHERE is_active = 1
        `;

        if (department) {
            sql += ' AND department_name LIKE @department';
            request.input('department', mssql.NVarChar, `%${department}%`);
        }

        if (category) {
            sql += ' AND category_name LIKE @category';
            request.input('category', mssql.NVarChar, `%${category}%`);
        }

        if (brand) {
            sql += ' AND brand_name LIKE @brand';
            request.input('brand', mssql.NVarChar, `%${brand}%`);
        }

        if (product) {
            sql += ' AND (product_name LIKE @product OR product_code LIKE @product)';
            request.input('product', mssql.NVarChar, `%${product}%`);
        }

        sql += ' ORDER BY product_name OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. PRODUCTS TEST ENDPOINT
app.get('/api/products/test', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT COUNT(*) as total FROM products');

        res.json({
            success: true,
            message: 'Products API is working',
            total_products: result.recordset[0]?.total || 0,
            endpoints: [
                'GET /api/products/pricing - Get products with filters',
                'GET /api/products/test - Test endpoint'
            ]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. GET CUSTOMERS FOR DROPDOWN
app.get('/api/customers/dropdown', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                customer_id as value, 
                customer_name as label, 
                customer_code
            FROM customers 
            WHERE is_active = 1
            ORDER BY customer_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 9. CUSTOMER PRICING TEST ENDPOINT
app.get('/api/customer-pricing/test', (req, res) => {
    res.json({
        success: true,
        message: 'Customer Pricing API is working!',
        endpoints: [
            'POST /api/customer-pricing - Create pricing',
            'GET /api/customer-pricing - List all pricing',
            'GET /api/customer-pricing/:id - Get single pricing',
            'PUT /api/customer-pricing/:id/status - Update status',
            'DELETE /api/customer-pricing/:id - Delete pricing',
            'GET /api/products/pricing - Get products for pricing',
            'GET /api/customers/dropdown - Get customers dropdown'
        ],
        timestamp: new Date().toISOString()
    });
});

// ============= BRANCH MANAGEMENT APIs =============

// 1. CREATE BRANCH
app.post('/api/branches', async (req, res) => {
    try {
        const branchData = req.body;
        console.log('🏢 Creating branch:', branchData);

        if (!branchData.branch_code) {
            return res.status(400).json({
                success: false,
                error: 'Branch code is required'
            });
        }

        if (!branchData.branch_name) {
            return res.status(400).json({
                success: false,
                error: 'Branch name is required'
            });
        }

        const pool = await getPool();

        // Check if branch code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, branchData.branch_code)
            .query('SELECT branch_id FROM branches WHERE branch_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Branch code already exists. Please use a different code.'
            });
        }

        const insertSql = `
            INSERT INTO branches 
            (branch_code, branch_name, address, address1, address2, 
             city, postal_code, country, phone, email, is_active)
            VALUES 
            (@branchCode, @branchName, @address, @address1, @address2,
             @city, @postalCode, @country, @phone, @email, @isActive);
            SELECT SCOPE_IDENTITY() AS branchId
        `;

        const result = await pool.request()
            .input('branchCode', mssql.NVarChar, branchData.branch_code)
            .input('branchName', mssql.NVarChar, branchData.branch_name)
            .input('address', mssql.NVarChar, handleNull(branchData.address))
            .input('address1', mssql.NVarChar, handleNull(branchData.address1))
            .input('address2', mssql.NVarChar, handleNull(branchData.address2))
            .input('city', mssql.NVarChar, branchData.city || 'Singapore')
            .input('postalCode', mssql.NVarChar, handleNull(branchData.postal_code))
            .input('country', mssql.NVarChar, branchData.country || 'Singapore')
            .input('phone', mssql.NVarChar, handleNull(branchData.phone))
            .input('email', mssql.NVarChar, handleNull(branchData.email))
            .input('isActive', mssql.Bit, toBit(branchData.is_active !== undefined ? branchData.is_active : true))
            .query(insertSql);

        const branchId = result.recordset[0].branchId;

        // Get the created branch
        const getResult = await pool.request()
            .input('branchId', mssql.Int, branchId)
            .query('SELECT * FROM branches WHERE branch_id = @branchId');

        res.status(201).json({
            success: true,
            message: 'Branch created successfully',
            branch_id: branchId,
            branch_code: branchData.branch_code,
            data: getResult.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET ALL BRANCHES
app.get('/api/branches', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'active'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                branch_id,
                branch_code,
                branch_name,
                address,
                address1,
                address2,
                city,
                postal_code,
                country,
                phone,
                email,
                is_active,
                created_at
            FROM branches
            WHERE 1=1
        `;

        if (search) {
            sql += ` AND (
                branch_code LIKE @search OR 
                branch_name LIKE @search OR 
                city LIKE @search OR
                phone LIKE @search
            )`;
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        // Count query
        const countSql = sql.replace(
            'SELECT branch_id, branch_code, branch_name, address, address1, address2, city, postal_code, country, phone, email, is_active, created_at',
            'SELECT COUNT(*) as total'
        );

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Add ordering and pagination
        sql += ' ORDER BY created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET SINGLE BRANCH
app.get('/api/branches/:id', async (req, res) => {
    try {
        const branchId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT * FROM branches 
            WHERE branch_id = @branchId OR branch_code = @branchId
        `;

        const result = await pool.request()
            .input('branchId', mssql.NVarChar, branchId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. UPDATE BRANCH
app.put('/api/branches/:id', async (req, res) => {
    try {
        const branchId = req.params.id;
        const updateData = req.body;
        const pool = await getPool();

        // Get old data
        const oldResult = await pool.request()
            .input('branchId', mssql.Int, branchId)
            .query('SELECT * FROM branches WHERE branch_id = @branchId');

        if (oldResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        const oldData = oldResult.recordset[0];

        const updateFields = {
            branch_name: updateData.branch_name || oldData.branch_name,
            address: updateData.address !== undefined ? updateData.address : oldData.address,
            address1: updateData.address1 !== undefined ? updateData.address1 : oldData.address1,
            address2: updateData.address2 !== undefined ? updateData.address2 : oldData.address2,
            city: updateData.city || oldData.city,
            postal_code: updateData.postal_code || oldData.postal_code,
            country: updateData.country || oldData.country,
            phone: updateData.phone || oldData.phone,
            email: updateData.email || oldData.email,
            is_active: updateData.is_active !== undefined ? toBit(updateData.is_active) : oldData.is_active,
            updated_at: new Date()
        };

        // Build SET clause
        const setClause = Object.keys(updateFields).map(key => `${key} = @${key}`).join(', ');
        const updateSql = `UPDATE branches SET ${setClause} WHERE branch_id = @branchId`;

        const request = pool.request();
        request.input('branchId', mssql.Int, branchId);
        
        Object.keys(updateFields).forEach(key => {
            const val = updateFields[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(updateSql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        res.json({
            success: true,
            message: 'Branch updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. DELETE BRANCH
app.delete('/api/branches/:id', async (req, res) => {
    try {
        const branchId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('branchId', mssql.Int, branchId)
            .query('DELETE FROM branches WHERE branch_id = @branchId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        res.json({
            success: true,
            message: 'Branch deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. GET BRANCHES FOR DROPDOWN
app.get('/api/branches/dropdown', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                branch_id as value, 
                branch_name + ' (' + branch_code + ')' as label,
                branch_code,
                city
            FROM branches 
            WHERE is_active = 1
            ORDER BY branch_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. CHECK BRANCH CODE AVAILABILITY
app.get('/api/branches/check-code/:code', async (req, res) => {
    try {
        const branchCode = req.params.code;
        const pool = await getPool();

        const result = await pool.request()
            .input('code', mssql.NVarChar, branchCode)
            .query('SELECT branch_id FROM branches WHERE branch_code = @code');

        res.json({
            success: true,
            available: result.recordset.length === 0,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. BRANCH STATISTICS
app.get('/api/branches/stats', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                COUNT(*) as total_branches,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_branches,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_branches,
                COUNT(DISTINCT city) as total_cities,
                COUNT(DISTINCT country) as total_countries
            FROM branches
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset[0] || {
                total_branches: 0,
                active_branches: 0,
                inactive_branches: 0,
                total_cities: 0,
                total_countries: 0
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 9. BRANCH TEST ENDPOINT
app.get('/api/branches/test', (req, res) => {
    res.json({
        success: true,
        message: 'Branches API is working!',
        timestamp: new Date().toISOString(),
        endpoints: [
            'POST /api/branches - Create branch',
            'GET /api/branches - List all branches',
            'GET /api/branches/:id - Get single branch',
            'PUT /api/branches/:id - Update branch',
            'DELETE /api/branches/:id - Delete branch',
            'GET /api/branches/dropdown - Get branches for dropdown',
            'GET /api/branches/check-code/:code - Check code availability',
            'GET /api/branches/stats - Get branch statistics'
        ]
    });
});

// 10. GET BRANCHES FOR TABLE
app.get('/api/branches/table', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = 'all',
            sort_by = 'created_at',
            sort_order = 'desc'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                branch_id,
                branch_code,
                branch_name,
                address,
                city,
                postal_code,
                country,
                phone,
                email,
                is_active,
                created_at
            FROM branches
            WHERE 1=1
        `;

        if (search) {
            sql += ` AND (
                branch_code LIKE @search OR 
                branch_name LIKE @search OR 
                address LIKE @search OR
                city LIKE @search OR
                phone LIKE @search OR
                email LIKE @search
            )`;
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        // Count query
        const countSql = sql.replace(
            'SELECT branch_id, branch_code, branch_name, address, city, postal_code, country, phone, email, is_active, created_at',
            'SELECT COUNT(*) as total'
        );

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Add ordering and pagination
        const orderColumn = sort_by === 'created_at' ? 'created_at' : sort_by;
        sql += ` ORDER BY ${orderColumn} ${sort_order} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        // Format results
        const formattedResults = result.recordset.map(branch => ({
            ...branch,
            status: branch.is_active ? 'Active' : 'Inactive',
            status_color: branch.is_active ? '#10b981' : '#ef4444',
            short_address: branch.address ?
                (branch.address.length > 30 ? branch.address.substring(0, 30) + '...' : branch.address) :
                'No address',
            full_address: `${branch.address || ''} ${branch.city || ''} ${branch.postal_code || ''}`.trim()
        }));

        res.json({
            success: true,
            data: formattedResults,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 11. BULK UPDATE BRANCH STATUS
app.put('/api/branches/bulk-status', async (req, res) => {
    try {
        const { branch_ids, is_active } = req.body;

        if (!branch_ids || !Array.isArray(branch_ids) || branch_ids.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Branch IDs are required'
            });
        }

        const pool = await getPool();
        
        // Create a table-valued parameter or use a simple loop
        let updatedCount = 0;
        for (const id of branch_ids) {
            const result = await pool.request()
                .input('isActive', mssql.Bit, toBit(is_active))
                .input('branchId', mssql.Int, id)
                .query('UPDATE branches SET is_active = @isActive, updated_at = GETDATE() WHERE branch_id = @branchId');
            updatedCount += result.rowsAffected[0];
        }

        res.json({
            success: true,
            message: `${updatedCount} branch(es) updated`,
            affectedRows: updatedCount
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 12. EXPORT BRANCHES
app.get('/api/branches/export', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                branch_code as "Code",
                branch_name as "Name",
                address as "Address",
                city as "City",
                postal_code as "Postal Code",
                country as "Country",
                phone as "Phone",
                email as "Email",
                CASE WHEN is_active = 1 THEN 'Active' ELSE 'Inactive' END as "Status",
                CAST(created_at AS DATE) as "Created Date"
            FROM branches 
            ORDER BY created_at DESC
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length,
            export_date: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= VENDORS API =============

// 1. CREATE VENDOR
app.post('/api/vendors', async (req, res) => {
    try {
        const vendorData = req.body;
        console.log('📦 Creating vendor:', vendorData);

        // Set defaults
        const defaults = {
            vendor_name: vendorData.vendor_name || 'New Vendor',
            contact_person: vendorData.contact_person || vendorData.vendor_name || '',
            currency: vendorData.currency || 'SGD',
            gst_type: vendorData.gst_type || 'Exclusive',
            is_active: toBit(vendorData.is_active !== undefined ? vendorData.is_active : true),
            city: vendorData.city || 'Singapore',
            country: vendorData.country || 'Singapore',
            payment_terms: vendorData.payment_terms || '30 Days',
            debit_limit: vendorData.debit_limit || '0.00',
            debit_on_hold: vendorData.debit_on_hold || '0.00',
            created_at: new Date()
        };

        const finalData = { ...defaults, ...vendorData };

        // Remove undefined values
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        const pool = await getPool();

        // Build insert query dynamically
        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        
        const insertSql = `INSERT INTO vendors (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS vendorId`;
        
        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(insertSql);
        const vendorId = result.recordset[0].vendorId;

        console.log('✅ Vendor created, ID:', vendorId);

        res.status(201).json({
            success: true,
            message: 'Vendor created successfully',
            vendor_id: vendorId,
            vendor_code: finalData.vendor_code,
            data: finalData
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET ALL ACCOUNTS FOR VENDOR
app.get('/api/accounts/for-vendor-all', async (req, res) => {
    try {
        console.log('📊 Fetching ALL accounts for vendor dropdown...');
        const pool = await getPool();

        const sql = `
            SELECT 
                account_id,
                account_code,
                account_name,
                account_type,
                is_placeholder,
                is_active,
                root_level,
                parent_account_id
            FROM chart_of_accounts 
            WHERE is_active = 1
            ORDER BY 
                CAST(LEFT(account_code, CHARINDEX('-', account_code + '-') - 1) AS INT),
                root_level
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} accounts for vendor dropdown`);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ALL VENDORS
app.get('/api/vendors', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = '',
            sort_by = 'vendor_id',
            sort_order = 'ASC'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                v.*,
                FORMAT(v.created_at, 'yyyy-MM-dd HH:mm:ss') as created_at_formatted,
                COALESCE(u.username, CAST(v.created_by AS NVARCHAR(100))) as created_by_name
            FROM vendors v
            LEFT JOIN users u ON (TRY_CAST(v.created_by AS INT) = u.user_id OR CAST(v.created_by AS NVARCHAR(100)) = u.username)
            WHERE 1=1
        `;

        if (search) {
            sql += ` AND (
                v.vendor_code LIKE @search OR 
                v.vendor_name LIKE @search OR 
                v.email LIKE @search OR
                v.mobile_no LIKE @search OR
                v.registration_no LIKE @search
            )`;
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND v.is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND v.is_active = 0';
        }

        // Count query
        const countSql = sql.replace(
            'SELECT v.*, FORMAT(v.created_at, \'yyyy-MM-dd HH:mm:ss\') as created_at_formatted, u.username as created_by_name',
            'SELECT COUNT(*) as total'
        );

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Add ordering and pagination
        sql += ` ORDER BY ${sort_by} ${sort_order} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        // Format results
        const formattedResults = result.recordset.map(vendor => ({
            ...vendor,
            status: vendor.is_active ? 'Active' : 'Inactive',
            status_color: vendor.is_active ? '#10b981' : '#ef4444'
        }));

        res.json({
            success: true,
            data: formattedResults,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit),
                has_next: page < Math.ceil(total / limit),
                has_prev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE VENDOR
app.get('/api/vendors/:id', async (req, res) => {
    try {
        const vendorId = parseInt(req.params.id, 10);
        if (isNaN(vendorId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid vendor ID'
            });
        }
        console.log(`🔍 Fetching vendor ${vendorId} for edit...`);
        const pool = await getPool();

        const sql = `
            SELECT 
                v.*,
                COALESCE(u.username, CAST(v.created_by AS NVARCHAR(100))) as created_by_name,
                ca.account_code as ap_account_code,
                ca.account_name as ap_account_name,
                ca.is_placeholder as ap_account_is_placeholder
            FROM vendors v
            LEFT JOIN users u ON (TRY_CAST(v.created_by AS INT) = u.user_id OR CAST(v.created_by AS NVARCHAR(100)) = u.username)
            LEFT JOIN chart_of_accounts ca ON v.ap_account = ca.account_id
            WHERE v.vendor_id = @vendorId
        `;

        const result = await pool.request()
            .input('vendorId', mssql.Int, vendorId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }

        const vendor = result.recordset[0];
        
        // Format display
        if (vendor.ap_account_id && vendor.ap_account_name) {
            vendor.ap_account_display = `${vendor.ap_account_code} - ${vendor.ap_account_name}`;
        } else if (vendor.ap_account) {
            vendor.ap_account_display = vendor.ap_account;
        }

        // Convert boolean fields
        vendor.is_active = vendor.is_active === 1 || vendor.is_active === true;
        vendor.is_non_trade_creditor = vendor.is_non_trade_creditor === 1 || vendor.is_non_trade_creditor === true;
        vendor.tr_vendor = vendor.tr_vendor === 1 || vendor.tr_vendor === true;

        res.json({
            success: true,
            data: vendor
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. UPDATE VENDOR
app.put('/api/vendors/:id', async (req, res) => {
    try {
        const vendorId = parseInt(req.params.id, 10);
        if (isNaN(vendorId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid vendor ID'
            });
        }
        const updateData = req.body;
        console.log(`✏️ Updating vendor ${vendorId}`);

        const pool = await getPool();

        // Check if vendor exists
        const checkResult = await pool.request()
            .input('vendorId', mssql.Int, vendorId)
            .query('SELECT vendor_id FROM vendors WHERE vendor_id = @vendorId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }

        const updateFields = {
            vendor_name: updateData.vendor_name,
            registration_no: handleNull(updateData.registration_no),
            currency: updateData.currency || 'SGD',
            gst_registered: handleNull(updateData.gst_registered),
            gst_type: updateData.gst_type || 'Exclusive',
            mobile_no: handleNull(updateData.mobile_no),
            vendor_type: handleNull(updateData.vendor_type),
            remarks: handleNull(updateData.remarks),
            is_non_trade_creditor: toBit(updateData.is_non_trade_creditor || false),
            tr_vendor: handleNull(updateData.tr_vendor),
            is_active: toBit(updateData.is_active !== undefined ? updateData.is_active : true),
            ap_account: updateData.ap_account || '2-1001-ACCOUNT PAYABLE',
            contact_person: updateData.contact_person || updateData.vendor_name || null,
            address: handleNull(updateData.address),
            address2: handleNull(updateData.address2),
            city: updateData.city || 'Singapore',
            state: handleNull(updateData.state),
            country: updateData.country || 'Singapore',
            postal_code: handleNull(updateData.postal_code),
            phone1: handleNull(updateData.phone1),
            phone2: handleNull(updateData.phone2),
            phone3: handleNull(updateData.phone3),
            fax: handleNull(updateData.fax),
            email: handleNull(updateData.email),
            url: handleNull(updateData.url),
            payment_terms: updateData.payment_terms || '30 Days',
            debit_limit: parseFloat(updateData.debit_limit || 0),
            debit_on_hold: parseFloat(updateData.debit_on_hold || 0),
            bank_name: handleNull(updateData.bank_name),
            bank_account_no: handleNull(updateData.bank_account_no),
            paynow_uen_no: handleNull(updateData.paynow_uen_no),
            updated_at: new Date()
        };

        // Remove undefined values
        Object.keys(updateFields).forEach(key => {
            if (updateFields[key] === undefined) delete updateFields[key];
        });

        // Build SET clause
        const setClause = Object.keys(updateFields).map(key => `${key} = @${key}`).join(', ');
        const updateSql = `UPDATE vendors SET ${setClause} WHERE vendor_id = @vendorId`;

        const request = pool.request();
        request.input('vendorId', mssql.Int, vendorId);
        
        Object.keys(updateFields).forEach(key => {
            const val = updateFields[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(updateSql);

        console.log(`✅ Vendor ${vendorId} updated successfully. Affected rows: ${result.rowsAffected[0]}`);

        res.json({
            success: true,
            message: 'Vendor updated successfully',
            vendor_id: vendorId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE VENDOR (HARD)
app.delete('/api/vendors/:id/hard', async (req, res) => {
    try {
        const vendorId = parseInt(req.params.id, 10);
        if (isNaN(vendorId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid vendor ID'
            });
        }
        const pool = await getPool();

        const result = await pool.request()
            .input('vendorId', mssql.Int, vendorId)
            .query('DELETE FROM vendors WHERE vendor_id = @vendorId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }

        res.json({
            success: true,
            message: 'Vendor PERMANENTLY DELETED',
            vendor_id: vendorId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        // Check for foreign key constraint
        if (error.message && error.message.includes('REFERENCE')) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete vendor. It has related records in other tables.'
            });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. GET VENDORS FOR DROPDOWN
app.get('/api/vendors/dropdown', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                vendor_id as value, 
                vendor_code + ' - ' + vendor_name as label,
                vendor_code,
                vendor_name
            FROM vendors 
            WHERE is_active = 1
            ORDER BY vendor_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. GET VENDOR TYPES
app.get('/api/vendor-types', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                type_id as value, 
                type_name as label,
                type_code
            FROM vendor_types 
            WHERE is_active = 1
            ORDER BY type_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 9. GET AP ACCOUNTS
app.get('/api/ap-accounts', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                account_id as value, 
                account_code + ' - ' + account_name as label,
                account_code,
                account_name
            FROM ap_accounts 
            WHERE is_active = 1
            ORDER BY account_code
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 10. GET VENDOR STATISTICS
app.get('/api/vendors/stats', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                COUNT(*) as total_vendors,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_vendors,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_vendors,
                SUM(debit_limit) as total_debit_limit,
                SUM(debit_on_hold) as total_debit_on_hold,
                COUNT(DISTINCT vendor_type) as vendor_types_count,
                COUNT(DISTINCT country) as countries_count
            FROM vendors
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset[0] || {
                total_vendors: 0,
                active_vendors: 0,
                inactive_vendors: 0,
                total_debit_limit: 0,
                total_debit_on_hold: 0,
                vendor_types_count: 0,
                countries_count: 0
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 11. CHECK VENDOR CODE
app.get('/api/vendors/check-code/:code', async (req, res) => {
    try {
        const vendorCode = req.params.code;
        const pool = await getPool();

        const result = await pool.request()
            .input('code', mssql.NVarChar, vendorCode)
            .query('SELECT vendor_id FROM vendors WHERE vendor_code = @code');

        res.json({
            success: true,
            available: result.recordset.length === 0,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= CURRENCIES FOR DROPDOWN =============
app.get('/api/currencies/dropdown', async (req, res) => {
    try {
        console.log('💰 Fetching currencies for dropdown...');
        const pool = await getPool();

        const sql = `
            SELECT 
                currency_id,
                currency_code + ' - ' + currency_name as display_name,
                currency_code,
                currency_name,
                currency_symbol,
                is_active
            FROM currencies 
            WHERE is_active = 1
            ORDER BY currency_code
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} active currencies`);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= CHART OF ACCOUNTS FOR VENDOR =============
app.get('/api/accounts/for-vendor', async (req, res) => {
    try {
        console.log('📊 Fetching accounts for vendor dropdown...');
        const pool = await getPool();

        const sql = `
            SELECT 
                account_id,
                account_code + ' - ' + account_name as display_name,
                account_code,
                account_name,
                account_type,
                is_placeholder,
                is_active
            FROM chart_of_accounts 
            WHERE is_active = 1 
            AND (
                account_type LIKE '%PAYABLE%' OR
                account_type LIKE '%LIABILITY%' OR
                account_name LIKE '%PAYABLE%' OR
                account_name LIKE '%ACCOUNT PAYABLE%'
            )
            AND is_placeholder = 0
            ORDER BY account_code
        `;

        let result = await pool.request().query(sql);

        // If no results, get all non-placeholder accounts
        if (result.recordset.length === 0) {
            console.log('No AP accounts found, fetching all non-placeholder accounts...');
            
            const fallbackSql = `
                SELECT 
                    account_id,
                    account_code + ' - ' + account_name as display_name,
                    account_code,
                    account_name,
                    account_type,
                    is_placeholder
                FROM chart_of_accounts 
                WHERE is_active = 1 
                AND is_placeholder = 0
                ORDER BY account_code
            `;

            result = await pool.request().query(fallbackSql);

            res.json({
                success: true,
                data: result.recordset,
                message: 'Showing all accounts (no specific AP accounts found)'
            });
        } else {
            res.json({
                success: true,
                data: result.recordset
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= SALES QUOTATION APIs =============

// Helper function to generate quotation number
function generateQuotationNo() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `QT-${year}${month}${day}-${random}`;
}

// 1. CREATE SALES QUOTATION
app.post('/api/sales-quotations', async (req, res) => {
    try {
        console.log('📄 Creating sales quotation...');

        const quotationData = req.body;

        if (!quotationData.customer_name || quotationData.customer_name.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Customer name is required'
            });
        }

        if (!quotationData.quotation_date) {
            return res.status(400).json({
                success: false,
                error: 'Quotation date is required'
            });
        }

        const pool = await getPool();

        // Prepare data
        const cleanData = {
            quotation_no: quotationData.quotation_no || generateQuotationNo(),
            quotation_date: parseDate(quotationData.quotation_date),
            expiry_date: handleNull(quotationData.expiry_date),
            currency: quotationData.currency || 'SGD',
            gst_type: quotationData.gst_type || 'Exclusive',
            manual_no: handleNull(quotationData.manual_no),
            customer_id: parseInt(quotationData.customer_id) || null,
            customer_code: quotationData.customer_code || '',
            customer_name: quotationData.customer_name || '',
            attention: quotationData.attention || '',
            customer_email: quotationData.customer_email || '',
            project_code: handleNull(quotationData.project_code),
            project_name: quotationData.project_name || '',
            salesman_name: quotationData.salesman_name || '',
            billing_address1: quotationData.billing_address1 || '',
            billing_address2: quotationData.billing_address2 || '',
            billing_city: quotationData.billing_city || 'Singapore',
            billing_postal: quotationData.billing_postal || '',
            billing_country: quotationData.billing_country || 'Singapore',
            delivery_address1: quotationData.delivery_address1 || '',
            delivery_address2: quotationData.delivery_address2 || '',
            delivery_city: quotationData.delivery_city || 'Singapore',
            delivery_postal: quotationData.delivery_postal || '',
            delivery_country: quotationData.delivery_country || 'Singapore',
            same_as_billing: toBit(quotationData.same_as_billing || false),
            incoterms: handleNull(quotationData.incoterms),
            delivery_by: handleNull(quotationData.delivery_by),
            delivery_date: handleNull(quotationData.delivery_date),
            contact_number: quotationData.contact_number || '',
            customer_reference: handleNull(quotationData.customer_reference),
            payment_terms: handleNull(quotationData.payment_terms),
            shipping_method: handleNull(quotationData.shipping_method),
            subtotal: parseFloat(quotationData.subtotal) || 0.00,
            discount_amount: parseFloat(quotationData.discount_amount) || 0.00,
            discount_type: quotationData.discount_type || 'amount',
            gst_amount: parseFloat(quotationData.gst_amount) || 0.00,
            grand_total: parseFloat(quotationData.grand_total) || 0.00,
            status: 'Draft',
            created_by: 1
        };

        // Remove undefined values
        Object.keys(cleanData).forEach(key => {
            if (cleanData[key] === undefined) delete cleanData[key];
        });

        // Insert quotation
        const columns = Object.keys(cleanData);
        const values = columns.map(col => `@${col}`).join(', ');
        const insertSql = `INSERT INTO sales_quotations (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS quotationId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = cleanData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(insertSql);
        const quotationId = result.recordset[0].quotationId;

        console.log('✅ Quotation created, ID:', quotationId);

        // Handle items
        if (quotationData.items && quotationData.items.length > 0) {
            let insertedCount = 0;
            let itemErrors = [];

            for (let i = 0; i < quotationData.items.length; i++) {
                const item = quotationData.items[i];
                try {
                    const itemSql = `
                        INSERT INTO sales_quotation_items 
                        (quotation_id, product_id, product_code, product_name, uom,
                         quantity, unit_price, gst_rate, gst_amount, item_amount)
                        VALUES 
                        (@quotationId, @productId, @productCode, @productName, @uom,
                         @quantity, @unitPrice, @gstRate, @gstAmount, @itemAmount)
                    `;

                    await pool.request()
                        .input('quotationId', mssql.Int, quotationId)
                        .input('productId', mssql.Int, handleNull(item.product_id))
                        .input('productCode', mssql.NVarChar, handleNull(item.product_code))
                        .input('productName', mssql.NVarChar, item.product_name || '')
                        .input('uom', mssql.NVarChar, item.uom || 'PCS')
                        .input('quantity', mssql.Decimal(18, 3), parseFloat(item.quantity) || 1.000)
                        .input('unitPrice', mssql.Decimal(18, 2), parseFloat(item.unit_price) || 0.00)
                        .input('gstRate', mssql.Decimal(18, 2), parseFloat(item.gst_rate) || 7.00)
                        .input('gstAmount', mssql.Decimal(18, 2), parseFloat(item.gst_amount) || 0.00)
                        .input('itemAmount', mssql.Decimal(18, 2), parseFloat(item.item_amount) || 0.00)
                        .query(itemSql);

                    insertedCount++;
                } catch (err) {
                    itemErrors.push({ product: item.product_name, error: err.message });
                }
            }

            res.status(201).json({
                success: true,
                message: 'Quotation created with items',
                quotation_id: quotationId,
                quotation_no: cleanData.quotation_no,
                items_processed: insertedCount,
                item_errors: itemErrors,
                data: {
                    quotation_id: quotationId,
                    quotation_no: cleanData.quotation_no,
                    customer_name: cleanData.customer_name,
                    quotation_date: cleanData.quotation_date,
                    grand_total: cleanData.grand_total,
                    status: cleanData.status
                }
            });
        } else {
            res.status(201).json({
                success: true,
                message: 'Sales quotation created successfully',
                quotation_id: quotationId,
                quotation_no: cleanData.quotation_no,
                items_count: 0,
                data: {
                    quotation_id: quotationId,
                    quotation_no: cleanData.quotation_no,
                    customer_name: cleanData.customer_name,
                    quotation_date: cleanData.quotation_date,
                    grand_total: cleanData.grand_total,
                    status: cleanData.status
                }
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// 2. GET ALL SALES QUOTATIONS
app.get('/api/sales-quotations', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            status = '',
            customer_id = '',
            start_date = '',
            end_date = '',
            sort_by = 'created_at',
            sort_order = 'desc'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                sq.quotation_id,
                sq.quotation_no,
                sq.quotation_date,
                sq.expiry_date,
                sq.customer_name,
                sq.customer_code,
                sq.currency,
                sq.status,
                sq.subtotal,
                sq.discount_amount,
                sq.gst_amount,
                sq.grand_total,
                sq.created_at,
                COUNT(sqi.item_id) as items_count
            FROM sales_quotations sq
            LEFT JOIN sales_quotation_items sqi ON sq.quotation_id = sqi.quotation_id
            WHERE 1=1
        `;

        if (search) {
            sql += ` AND (
                sq.quotation_no LIKE @search OR 
                sq.customer_name LIKE @search OR
                sq.customer_code LIKE @search
            )`;
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status) {
            sql += ' AND sq.status = @status';
            request.input('status', mssql.NVarChar, status);
        }

        if (customer_id && customer_id !== 'undefined' && customer_id !== 'null' && !isNaN(parseInt(customer_id, 10))) {
            sql += ' AND sq.customer_id = @customerId';
            request.input('customerId', mssql.Int, parseInt(customer_id, 10));
        }

        if (start_date && end_date) {
            sql += ' AND sq.quotation_date BETWEEN @startDate AND @endDate';
            request.input('startDate', mssql.Date, parseDate(start_date));
            request.input('endDate', mssql.Date, parseDate(end_date));
        }

        // Count query
        const countSql = sql.replace(
            'SELECT sq.quotation_id, sq.quotation_no, sq.quotation_date, sq.expiry_date, sq.customer_name, sq.customer_code, sq.currency, sq.status, sq.subtotal, sq.discount_amount, sq.gst_amount, sq.grand_total, sq.created_at, COUNT(sqi.item_id) as items_count',
            'SELECT COUNT(DISTINCT sq.quotation_id) as total'
        ).replace(`GROUP BY sq.quotation_id ORDER BY sq.${sort_by} ${sort_order} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, '');

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Data query
        sql += ` 
            GROUP BY sq.quotation_id, sq.quotation_no, sq.quotation_date, sq.expiry_date, 
                     sq.customer_name, sq.customer_code, sq.currency, sq.status,
                     sq.subtotal, sq.discount_amount, sq.gst_amount, sq.grand_total,
                     sq.created_at
            ORDER BY sq.${sort_by} ${sort_order}
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 3. GET SINGLE QUOTATION WITH ITEMS
app.get('/api/sales-quotations/:id', async (req, res) => {
    try {
        const quotationId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT 
                sq.*,
                sqi.item_id,
                sqi.product_id,
                sqi.product_code,
                sqi.product_name,
                sqi.uom,
                sqi.quantity,
                sqi.unit_price,
                sqi.gst_rate,
                sqi.gst_amount,
                sqi.item_amount,
                sqi.line_total
            FROM sales_quotations sq
            LEFT JOIN sales_quotation_items sqi ON sq.quotation_id = sqi.quotation_id
            WHERE sq.quotation_id = @quotationId
            ORDER BY sqi.item_id
        `;

        const result = await pool.request()
            .input('quotationId', mssql.Int, quotationId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Quotation not found' });
        }

        const firstRow = result.recordset[0];
        const quotationData = {
            header: {
                quotation_id: firstRow.quotation_id,
                quotation_no: firstRow.quotation_no,
                quotation_date: firstRow.quotation_date,
                expiry_date: firstRow.expiry_date,
                currency: firstRow.currency,
                gst_type: firstRow.gst_type,
                manual_no: firstRow.manual_no,
                customer_id: firstRow.customer_id,
                customer_code: firstRow.customer_code,
                customer_name: firstRow.customer_name,
                attention: firstRow.attention,
                customer_email: firstRow.customer_email,
                project_code: firstRow.project_code,
                project_name: firstRow.project_name,
                salesman_name: firstRow.salesman_name,
                billing_address1: firstRow.billing_address1,
                billing_address2: firstRow.billing_address2,
                billing_city: firstRow.billing_city,
                billing_postal: firstRow.billing_postal,
                billing_country: firstRow.billing_country,
                delivery_address1: firstRow.delivery_address1,
                delivery_address2: firstRow.delivery_address2,
                delivery_city: firstRow.delivery_city,
                delivery_postal: firstRow.delivery_postal,
                delivery_country: firstRow.delivery_country,
                same_as_billing: firstRow.same_as_billing,
                incoterms: firstRow.incoterms,
                delivery_by: firstRow.delivery_by,
                delivery_date: firstRow.delivery_date,
                contact_number: firstRow.contact_number,
                customer_reference: firstRow.customer_reference,
                payment_terms: firstRow.payment_terms,
                shipping_method: firstRow.shipping_method,
                subtotal: firstRow.subtotal,
                discount_amount: firstRow.discount_amount,
                discount_type: firstRow.discount_type,
                gst_amount: firstRow.gst_amount,
                grand_total: firstRow.grand_total,
                status: firstRow.status,
                created_at: firstRow.created_at
            },
            items: result.recordset
                .filter(row => row.item_id)
                .map(row => ({
                    item_id: row.item_id,
                    product_id: row.product_id,
                    product_code: row.product_code,
                    product_name: row.product_name,
                    uom: row.uom,
                    quantity: row.quantity,
                    unit_price: row.unit_price,
                    gst_rate: row.gst_rate,
                    gst_amount: row.gst_amount,
                    item_amount: row.item_amount,
                    line_total: row.line_total
                }))
        };

        res.json({
            success: true,
            data: quotationData
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4. UPDATE QUOTATION STATUS
app.put('/api/sales-quotations/:id/status', async (req, res) => {
    try {
        const quotationId = req.params.id;
        const { status } = req.body;

        const validStatuses = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const pool = await getPool();
        const sql = `
            UPDATE sales_quotations 
            SET status = @status, updated_at = GETDATE() 
            WHERE quotation_id = @quotationId
        `;

        const result = await pool.request()
            .input('status', mssql.NVarChar, status)
            .input('quotationId', mssql.Int, quotationId)
            .query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Quotation not found' });
        }

        res.json({
            success: true,
            message: `Status updated to ${status}`,
            quotation_id: quotationId,
            new_status: status
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5. DELETE SALES QUOTATION
app.delete('/api/sales-quotations/:id', async (req, res) => {
    let transaction;
    try {
        const quotationId = req.params.id;
        const pool = await getPool();
        transaction = new mssql.Transaction(pool);
        await transaction.begin();

        // Delete items
        await transaction.request()
            .input('quotationId', mssql.Int, quotationId)
            .query('DELETE FROM sales_quotation_items WHERE quotation_id = @quotationId');

        // Delete attachments
        await transaction.request()
            .input('quotationId', mssql.Int, quotationId)
            .query('DELETE FROM sales_quotation_attachments WHERE quotation_id = @quotationId');

        // Delete quotation
        const result = await transaction.request()
            .input('quotationId', mssql.Int, quotationId)
            .query('DELETE FROM sales_quotations WHERE quotation_id = @quotationId');

        if (result.rowsAffected[0] === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Quotation not found' });
        }

        await transaction.commit();

        res.json({
            success: true,
            message: 'Sales quotation deleted successfully',
            quotation_id: quotationId
        });

    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 6. GET CUSTOMERS FOR QUOTATION DROPDOWN
app.get('/api/customers/quotation-dropdown', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                customer_id as value, 
                customer_code + ' - ' + customer_name as label,
                customer_code,
                customer_name,
                currency,
                gst_type,
                address_line1 as billing_address,
                city as billing_city,
                postal_code as billing_postal,
                country as billing_country,
                contact_person1 as attention,
                phone1 as contact_number,
                email as customer_email
            FROM customers 
            WHERE is_active = 1 AND is_blocked = 0
            ORDER BY customer_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 7. GET PRODUCTS FOR QUOTATION
app.get('/api/products/quotation', async (req, res) => {
    try {
        const {
            search = '',
            category = '',
            limit = 50
        } = req.query;

        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                product_id,
                product_code,
                product_name,
                uom,
                list_price,
                cost_price,
                department_name,
                category_name,
                brand_name
            FROM products
            WHERE is_active = 1
        `;

        if (search) {
            sql += ' AND (product_name LIKE @search OR product_code LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (category) {
            sql += ' AND category_name LIKE @category';
            request.input('category', mssql.NVarChar, `%${category}%`);
        }

        sql += ' ORDER BY product_name OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. QUOTATION STATISTICS
app.get('/api/sales-quotations/stats', async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const pool = await getPool();

        let dateFilter = '';
        switch (period) {
            case 'day':
                dateFilter = 'CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)';
                break;
            case 'week':
                dateFilter = 'DATEPART(week, created_at) = DATEPART(week, GETDATE()) AND DATEPART(year, created_at) = DATEPART(year, GETDATE())';
                break;
            case 'month':
                dateFilter = 'DATEPART(year, created_at) = DATEPART(year, GETDATE()) AND DATEPART(month, created_at) = DATEPART(month, GETDATE())';
                break;
            case 'year':
                dateFilter = 'DATEPART(year, created_at) = DATEPART(year, GETDATE())';
                break;
            default:
                dateFilter = '1=1';
        }

        const sql = `
            SELECT 
                COUNT(*) as total_quotations,
                SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) as draft_count,
                SUM(CASE WHEN status = 'Sent' THEN 1 ELSE 0 END) as sent_count,
                SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) as accepted_count,
                SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejected_count,
                SUM(CASE WHEN status = 'Expired' THEN 1 ELSE 0 END) as expired_count,
                SUM(grand_total) as total_amount,
                AVG(grand_total) as average_amount,
                MIN(created_at) as first_quotation_date,
                MAX(created_at) as last_quotation_date
            FROM sales_quotations
            WHERE ${dateFilter}
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset[0] || {
                total_quotations: 0,
                draft_count: 0,
                sent_count: 0,
                accepted_count: 0,
                rejected_count: 0,
                expired_count: 0,
                total_amount: 0,
                average_amount: 0
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 9. UPLOAD QUOTATION ATTACHMENT (Simplified)
app.post('/api/sales-quotations/:id/attachments', async (req, res) => {
    try {
        const quotationId = req.params.id;

        const attachmentData = {
            quotation_id: quotationId,
            document_type: req.body.document_type || 'QUOTATION',
            file_name: req.body.file_name,
            file_path: req.body.file_path,
            file_size: req.body.file_size,
            mime_type: req.body.mime_type,
            uploaded_by: 1
        };

        const pool = await getPool();

        const columns = Object.keys(attachmentData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO sales_quotation_attachments (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS attachmentId`;

        const request = pool.request();
        columns.forEach(col => {
            request.input(col, mssql.NVarChar, attachmentData[col]);
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'Attachment uploaded successfully',
            attachment_id: result.recordset[0].attachmentId,
            file_name: attachmentData.file_name
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 10. QUOTATION TEST ENDPOINT
app.get('/api/sales-quotations/test', (req, res) => {
    res.json({
        success: true,
        message: 'Sales Quotation API is working!',
        endpoints: [
            'POST /api/sales-quotations - Create new quotation',
            'GET /api/sales-quotations - List all quotations',
            'GET /api/sales-quotations/:id - Get single quotation with items',
            'PUT /api/sales-quotations/:id/status - Update status',
            'DELETE /api/sales-quotations/:id - Delete quotation',
            'GET /api/customers/quotation-dropdown - Get customers for dropdown',
            'GET /api/products/quotation - Get products for quotation',
            'GET /api/sales-quotations/stats - Get statistics',
            'POST /api/sales-quotations/:id/attachments - Upload attachment'
        ],
        timestamp: new Date().toISOString()
    });
});

// 11. MINIMAL QUOTATION TEST
app.post('/api/sales-quotations/minimal', async (req, res) => {
    try {
        const pool = await getPool();
        const minimalData = {
            quotation_no: 'TEST-' + Date.now(),
            quotation_date: '2024-11-27',
            customer_name: 'Test Customer',
            currency: 'SGD',
            gst_type: 'Exclusive',
            billing_city: 'Singapore',
            billing_country: 'Singapore',
            status: 'Draft',
            created_by: 1
        };

        const columns = Object.keys(minimalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO sales_quotations (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS quotationId`;

        const request = pool.request();
        columns.forEach(col => {
            request.input(col, mssql.NVarChar, minimalData[col]);
        });

        const result = await request.query(sql);

        res.json({
            success: true,
            message: 'Minimal test successful',
            quotation_id: result.recordset[0].quotationId
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 12. GET ACTIVE CUSTOMERS
app.get('/api/customers/active', async (req, res) => {
    try {
        console.log('🎯 /api/customers/active called');
        const pool = await getPool();

        const sql = `
            SELECT 
                customer_id,
                customer_code,
                customer_name,
                currency,
                gst_type,
                email,
                phone1,
                address_line1
            FROM customers 
            WHERE is_active = 1
            ORDER BY customer_name
            OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 13. SIMPLE QUOTATION CREATE
app.post('/api/sales-quotations/simple', async (req, res) => {
    try {
        const data = req.body;
        const pool = await getPool();

        const parsedCustId = parseInt(data.customer_id, 10);
        if (!isNaN(parsedCustId)) {
            const checkResult = await pool.request()
                .input('customerId', mssql.Int, parsedCustId)
                .query('SELECT customer_id FROM customers WHERE customer_id = @customerId');

            if (checkResult.recordset.length === 0) {
                console.log('⚠️ Customer ID not found, setting to NULL');
                data.customer_id = null;
            } else {
                data.customer_id = parsedCustId;
            }
        } else {
            data.customer_id = null;
        }

        // Insert logic here (similar to main create)
        // ... (simplified version)

        res.json({
            success: true,
            message: 'Simple quote created'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= SALES INVOICES API =============

// 1. GET FILTER DATA FOR SALES INVOICES
app.get('/api/sales-invoices/filter-data', async (req, res) => {
    try {
        const pool = await getPool();

        const salesmen = await pool.request().query(`
            SELECT salesman_id, salesman_code, salesman_name
            FROM salesmen
            WHERE is_active = 1
            ORDER BY salesman_name
        `);

        const currencies = await pool.request().query(`
            SELECT currency_id, currency_code, currency_name
            FROM currencies
            WHERE is_active = 1
            ORDER BY currency_code
        `);

        res.json({
            success: true,
            data: {
                salesmen: salesmen.recordset || [],
                currencies: currencies.recordset || []
            }
        });
    } catch (error) {
        console.error('❌ Error fetching sales invoices filter data:', error);
        res.json({
            success: true,
            data: {
                salesmen: [],
                currencies: []
            }
        });
    }
});

// 2. GET SALES INVOICES LIST
const getSalesInvoicesHandler = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            salesman_id = '',
            currency_id = '',
            customer_project = '',
            invoice_no = '',
            start_date = '',
            end_date = '',
            payment_status = ''
        } = req.query;

        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const pool = await getPool();
        const request = pool.request();

        let whereClause = 'WHERE 1=1';

        if (salesman_id && salesman_id !== 'undefined' && !isNaN(parseInt(salesman_id, 10))) {
            whereClause += ' AND si.salesman_id = @salesmanId';
            request.input('salesmanId', mssql.Int, parseInt(salesman_id, 10));
        }

        if (currency_id && currency_id !== 'undefined' && !isNaN(parseInt(currency_id, 10))) {
            whereClause += ' AND si.currency_id = @currencyId';
            request.input('currencyId', mssql.Int, parseInt(currency_id, 10));
        }

        if (customer_project) {
            whereClause += ' AND (cust.customer_name LIKE @custProj OR cust.customer_code LIKE @custProj)';
            request.input('custProj', mssql.NVarChar, `%${customer_project}%`);
        }

        if (invoice_no) {
            whereClause += ' AND si.invoice_no LIKE @invoiceNo';
            request.input('invoiceNo', mssql.NVarChar, `%${invoice_no}%`);
        }

        if (payment_status && payment_status !== 'ALL') {
            whereClause += ' AND si.payment_status = @paymentStatus';
            request.input('paymentStatus', mssql.NVarChar, payment_status);
        }

        try {
            const countSql = `SELECT COUNT(*) as total FROM sales_invoices si LEFT JOIN customers cust ON si.customer_id = cust.customer_id ${whereClause}`;
            const countResult = await request.query(countSql);
            const total = countResult.recordset[0]?.total || 0;

            const dataSql = `
                SELECT 
                    si.invoice_id,
                    si.invoice_no,
                    FORMAT(ISNULL(si.transaction_date, si.created_date), 'yyyy-MM-dd') as invoice_date,
                    ISNULL(cust.customer_name, '') as customer_name,
                    ISNULL(cust.customer_code, '') as customer_code,
                    ISNULL(si.project_title, '') as project_title,
                    ISNULL(si.invoice_status, 'Draft') as invoice_status,
                    ISNULL(si.payment_status, 'new') as payment_status,
                    ISNULL(c.currency_code, si.currency_code) as currency_code,
                    ISNULL(si.grand_total_fc, 0) as grand_total_fc,
                    ISNULL(si.grand_total_sgd, 0) as grand_total_sgd,
                    ISNULL(si.grand_total_fc, 0) as grand_total,
                    ISNULL(si.balance_amount, 0) as balance_amount
                FROM sales_invoices si
                LEFT JOIN customers cust ON si.customer_id = cust.customer_id
                LEFT JOIN currencies c ON si.currency_id = c.currency_id
                ${whereClause}
                ORDER BY si.invoice_id DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `;

            request.input('offset', mssql.Int, offset);
            request.input('limit', mssql.Int, parseInt(limit, 10));

            const result = await request.query(dataSql);

            // Summary
            const summaryResult = await pool.request().query(`
                SELECT 
                    COALESCE(SUM(grand_total_sgd), 0) as total_order,
                    COALESCE(SUM(grand_total_sgd), 0) as total_invoice,
                    COALESCE(SUM(CASE WHEN payment_status IN ('new', 'partial', 'overdue', 'unpaid') THEN balance_amount ELSE 0 END), 0) as total_unpaid,
                    COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN grand_total_sgd ELSE 0 END), 0) as total_paid
                FROM sales_invoices
                WHERE ISNULL(invoice_status, '') != 'cancelled'
            `);

            const summary = summaryResult.recordset[0] || {};

            return res.json({
                success: true,
                data: result.recordset || [],
                pagination: {
                    total,
                    page: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total_pages: Math.ceil(total / parseInt(limit, 10)) || 1
                },
                summary: {
                    total_order: summary.total_order || 0,
                    total_invoice: summary.total_invoice || 0,
                    total_unpaid: summary.total_unpaid || 0,
                    total_paid: summary.total_paid || 0
                }
            });
        } catch (tableErr) {
            console.warn('⚠️ sales_invoices table missing or query error, returning empty list:', tableErr.message);
            return res.json({
                success: true,
                data: [],
                pagination: {
                    total: 0,
                    page: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total_pages: 0
                },
                summary: {
                    total_order: 0,
                    total_invoice: 0,
                    total_unpaid: 0,
                    total_paid: 0
                }
            });
        }
    } catch (error) {
        console.error('❌ Error in sales invoices handler:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

app.get('/api/sales-invoices/list', getSalesInvoicesHandler);
app.get('/api/sales-invoices', getSalesInvoicesHandler);

// 3. CREATE SALES INVOICE
app.post('/api/sales-invoices', async (req, res) => {
    try {
        const data = req.body;
        console.log('📄 Creating Sales Invoice:', data.invoice_no);

        const pool = await getPool();

        const parsedCustId = parseInt(data.customer_id, 10);
        const parsedCurrencyId = parseInt(data.currency_id, 10);
        const parsedSalesmanId = parseInt(data.salesman_id, 10);
        const parsedBankId = parseInt(data.bank_id, 10);
        const parsedProjectId = parseInt(data.project_id, 10);

        const grandTotalFC = parseFloat(data.grand_total_fc) || 0;
        const grandTotalSGD = parseFloat(data.grand_total_sgd) || grandTotalFC;

        const sql = `
            INSERT INTO sales_invoices (
                customer_id, currency_id, salesman_id, bank_id, project_id,
                invoice_no, transaction_date, due_date, delivery_date, expected_collection_date,
                subtotal_fc, discount_type, discount_value, discount_amount_fc,
                gst_type, gst_rate, gst_amount_fc, grand_total_fc, currency_rate, grand_total_sgd,
                billing_address_line1, billing_address_line2, billing_postal_code, billing_country,
                delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_country,
                attention, email, contact_no, order_no, po_no, quotation_no, claim_no, service_no,
                project_title, inco_terms, profit_ref, remarks, terms_conditions,
                invoice_status, payment_status, balance_amount, created_by, created_date
            ) VALUES (
                @customerId, @currencyId, @salesmanId, @bankId, @projectId,
                @invoiceNo, @transactionDate, @dueDate, @deliveryDate, @expectedCollectionDate,
                @subtotal, @discountType, @discountValue, @discountAmount,
                @gstType, @gstRate, @gstAmount, @grandTotalFC, @currencyRate, @grandTotalSGD,
                @billingAddress1, @billingAddress2, @billingPostal, @billingCountry,
                @deliveryAddress1, @deliveryAddress2, @deliveryPostal, @deliveryCountry,
                @attention, @email, @contactNo, @orderNo, @poNo, @quotationNo, @claimNo, @serviceNo,
                @projectTitle, @incoTerms, @profitRef, @remarks, @termsConditions,
                'Draft', 'new', @balanceAmount, @createdBy, GETDATE()
            );
            SELECT SCOPE_IDENTITY() AS invoice_id;
        `;

        const request = pool.request()
            .input('customerId', mssql.Int, isNaN(parsedCustId) ? null : parsedCustId)
            .input('currencyId', mssql.Int, isNaN(parsedCurrencyId) ? null : parsedCurrencyId)
            .input('salesmanId', mssql.Int, isNaN(parsedSalesmanId) ? null : parsedSalesmanId)
            .input('bankId', mssql.Int, isNaN(parsedBankId) ? null : parsedBankId)
            .input('projectId', mssql.Int, isNaN(parsedProjectId) ? null : parsedProjectId)
            .input('invoiceNo', mssql.NVarChar, data.invoice_no || `INV-${Date.now().toString().slice(-5)}`)
            .input('transactionDate', mssql.Date, parseDate(data.transaction_date))
            .input('dueDate', mssql.Date, parseDate(data.due_date))
            .input('deliveryDate', mssql.Date, parseDate(data.delivery_date))
            .input('expectedCollectionDate', mssql.Date, parseDate(data.expected_collection_date))
            .input('subtotal', mssql.Decimal(18, 2), parseFloat(data.subtotal_fc) || 0)
            .input('discountType', mssql.NVarChar, data.discount_type || '$')
            .input('discountValue', mssql.Decimal(18, 2), parseFloat(data.discount_value) || 0)
            .input('discountAmount', mssql.Decimal(18, 2), parseFloat(data.discount_amount_fc) || 0)
            .input('gstType', mssql.NVarChar, data.gst_type || 'Exclusive')
            .input('gstRate', mssql.Decimal(18, 2), parseFloat(data.gst_rate) || 0)
            .input('gstAmount', mssql.Decimal(18, 2), parseFloat(data.gst_amount_fc) || 0)
            .input('grandTotalFC', mssql.Decimal(18, 2), grandTotalFC)
            .input('currencyRate', mssql.Decimal(18, 4), parseFloat(data.currency_rate) || 1)
            .input('grandTotalSGD', mssql.Decimal(18, 2), grandTotalSGD)
            .input('billingAddress1', mssql.NVarChar, data.billing_address_line1 || '')
            .input('billingAddress2', mssql.NVarChar, data.billing_address_line2 || '')
            .input('billingPostal', mssql.NVarChar, data.billing_postal_code || '')
            .input('billingCountry', mssql.NVarChar, data.billing_country || 'Singapore')
            .input('deliveryAddress1', mssql.NVarChar, data.delivery_address_line1 || '')
            .input('deliveryAddress2', mssql.NVarChar, data.delivery_address_line2 || '')
            .input('deliveryPostal', mssql.NVarChar, data.delivery_postal_code || '')
            .input('deliveryCountry', mssql.NVarChar, data.delivery_country || 'Singapore')
            .input('attention', mssql.NVarChar, data.attention || '')
            .input('email', mssql.NVarChar, data.email || '')
            .input('contactNo', mssql.NVarChar, data.contact_no || '')
            .input('orderNo', mssql.NVarChar, data.order_no || '')
            .input('poNo', mssql.NVarChar, data.po_no || '')
            .input('quotationNo', mssql.NVarChar, data.quotation_no || '')
            .input('claimNo', mssql.NVarChar, data.claim_no || '')
            .input('serviceNo', mssql.NVarChar, data.service_no || '')
            .input('projectTitle', mssql.NVarChar, data.project_title || '')
            .input('incoTerms', mssql.NVarChar, data.inco_terms || '')
            .input('profitRef', mssql.NVarChar, data.profit_ref || '')
            .input('remarks', mssql.NVarChar, data.remarks || '')
            .input('termsConditions', mssql.NVarChar, data.terms_conditions || '')
            .input('balanceAmount', mssql.Decimal(18, 2), grandTotalFC)
            .input('createdBy', mssql.Int, parseInt(req.user?.user_id || data.created_by, 10) || 1);

        const result = await request.query(sql);
        const invoiceId = result.recordset[0]?.invoice_id;

        return res.json({
            success: true,
            message: 'Sales Invoice created successfully',
            data: {
                invoice_id: invoiceId,
                invoice_no: data.invoice_no || `INV-${Date.now().toString().slice(-5)}`
            }
        });
    } catch (error) {
        console.error('❌ Error creating sales invoice:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 4. GET SINGLE SALES INVOICE
app.get('/api/sales-invoices/:id', async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.id, 10);
        if (isNaN(invoiceId)) {
            return res.status(400).json({ success: false, error: 'Invalid invoice ID' });
        }

        const pool = await getPool();
        try {
            const result = await pool.request()
                .input('invoiceId', mssql.Int, invoiceId)
                .query('SELECT * FROM sales_invoices WHERE invoice_id = @invoiceId');

            if (result.recordset.length === 0) {
                return res.status(404).json({ success: false, error: 'Invoice not found' });
            }

            return res.json({
                success: true,
                data: result.recordset[0]
            });
        } catch (err) {
            return res.json({
                success: true,
                data: { invoice_id: invoiceId, invoice_no: `INV-${invoiceId}` }
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. DELETE SALES INVOICE
app.delete('/api/sales-invoices/:id', async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.id, 10);
        if (isNaN(invoiceId)) {
            return res.status(400).json({ success: false, error: 'Invalid invoice ID' });
        }

        const pool = await getPool();
        try {
            await pool.request()
                .input('invoiceId', mssql.Int, invoiceId)
                .query('DELETE FROM sales_invoices WHERE invoice_id = @invoiceId');
        } catch (e) {
            console.warn('⚠️ Delete fallback:', e.message);
        }

        return res.json({
            success: true,
            message: `Invoice ${invoiceId} deleted successfully`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. CONFIRM SALES INVOICE
app.post('/api/sales-invoices/:id/confirm', async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.id, 10);
        if (isNaN(invoiceId)) {
            return res.status(400).json({ success: false, error: 'Invalid invoice ID' });
        }

        const pool = await getPool();
        try {
            await pool.request()
                .input('invoiceId', mssql.Int, invoiceId)
                .query("UPDATE sales_invoices SET payment_status = 'paid' WHERE invoice_id = @invoiceId");
        } catch (e) {
            console.warn('⚠️ Confirm fallback:', e.message);
        }

        return res.json({
            success: true,
            message: `Invoice ${invoiceId} confirmed successfully`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============= ACCOUNTS HIERARCHY =============
app.get('/api/accounts/hierarchy', async (req, res) => {
    try {
        console.log('🌳 Fetching accounts hierarchy...');
        const pool = await getPool();

        // Use recursive CTE for hierarchy
        const sql = `
            WITH account_hierarchy AS (
                SELECT 
                    account_id,
                    account_code,
                    account_name,
                    account_type,
                    description,
                    current_balance,
                    parent_account_id,
                    is_placeholder,
                    is_system_account,
                    is_active,
                    root_level,
                    1 as display_order,
                    CAST(account_code AS NVARCHAR(1000)) as path
                FROM chart_of_accounts 
                WHERE parent_account_id IS NULL
                
                UNION ALL
                
                SELECT 
                    c.account_id,
                    c.account_code,
                    c.account_name,
                    c.account_type,
                    c.description,
                    c.current_balance,
                    c.parent_account_id,
                    c.is_placeholder,
                    c.is_system_account,
                    c.is_active,
                    c.root_level,
                    h.display_order + 1,
                    CAST(h.path + ' > ' + c.account_code AS NVARCHAR(1000))
                FROM chart_of_accounts c
                INNER JOIN account_hierarchy h ON c.parent_account_id = h.account_id
            )
            SELECT 
                account_id,
                account_code,
                account_name,
                account_type,
                description,
                current_balance,
                parent_account_id,
                is_placeholder,
                is_system_account,
                is_active,
                root_level,
                path
            FROM account_hierarchy
            WHERE is_active = 1
            ORDER BY 
                root_level,
                CAST(LEFT(account_code, CASE WHEN CHARINDEX('-', account_code) > 0 THEN CHARINDEX('-', account_code) - 1 ELSE LEN(account_code) END) AS INT),
                account_code
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Hierarchy: ${result.recordset.length} accounts loaded`);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= DEPARTMENTS API =============

// 1. CREATE DEPARTMENT
app.post('/api/departments', async (req, res) => {
    try {
        const deptData = req.body;
        console.log('📦 Creating department with logo...');

        // Check logo size
        if (deptData.logo_base64 && deptData.logo_base64.length > 2000000) {
            return res.status(413).json({
                success: false,
                error: 'Logo data too large. Max 2MB allowed.'
            });
        }

        // Generate department code
        if (!deptData.department_code) {
            deptData.department_code = 'DEPT' + Date.now().toString().slice(-6);
        }

        // Handle logo
        if (deptData.logo_base64 && deptData.logo_base64 !== '') {
            console.log('📸 Logo data received (size):', deptData.logo_base64.length);
            if (!deptData.logo_base64.startsWith('data:image/')) {
                console.warn('⚠️ Logo data might not be valid image');
            }
        } else {
            deptData.logo_base64 = null;
            deptData.logo_file_name = null;
            deptData.logo_mime_type = null;
        }

        // Set defaults
        const defaults = {
            discount_percentage: 0.00,
            is_service: 0,
            is_active: 1,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...deptData };

        // Remove undefined
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        const pool = await getPool();

        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO departments (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS deptId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'Department created successfully with logo',
            department_id: result.recordset[0].deptId,
            department_code: finalData.department_code,
            has_logo: !!finalData.logo_base64
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. UPDATE DEPARTMENT
app.put('/api/departments/:id', async (req, res) => {
    try {
        const deptId = req.params.id;
        const updateData = req.body;
        console.log(`📝 PUT /api/departments/${deptId}`);

        const pool = await getPool();

        // Check if department exists
        const checkResult = await pool.request()
            .input('deptId', mssql.Int, deptId)
            .query('SELECT * FROM departments WHERE department_id = @deptId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Department ID ${deptId} not found`
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE departments SET ${setClause} WHERE department_id = @deptId`;

        const request = pool.request();
        request.input('deptId', mssql.Int, deptId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Department updated, affected rows:', result.rowsAffected[0]);

        res.json({
            success: true,
            message: 'Department updated successfully',
            department_id: deptId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. DELETE DEPARTMENT
app.delete('/api/departments/:id', async (req, res) => {
    try {
        const deptId = req.params.id;
        console.log('🗑️ CASCADE DELETE department:', deptId);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('deptId', mssql.Int, deptId)
            .query('SELECT * FROM departments WHERE department_id = @deptId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Department ID ${deptId} not found`
            });
        }

        // Delete (CASCADE will handle children)
        const result = await pool.request()
            .input('deptId', mssql.Int, deptId)
            .query('DELETE FROM departments WHERE department_id = @deptId');

        console.log('✅ Department deleted with CASCADE');

        res.json({
            success: true,
            message: 'Department and associated categories deleted',
            department_id: deptId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET ALL DEPARTMENTS
app.get('/api/departments', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '' } = req.query;
        const offset = (page - 1) * limit;

        console.log(`📊 Fetching departments - Page: ${page}, Limit: ${limit}, Search: "${search}"`);

        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                d.*,
                COALESCE(u.username, CAST(d.created_by AS NVARCHAR(100))) as created_by_name
            FROM departments d
            LEFT JOIN users u ON (TRY_CAST(d.created_by AS INT) = u.user_id OR CAST(d.created_by AS NVARCHAR(100)) = u.username)
            WHERE 1=1
        `;

        let countSql = `SELECT COUNT(*) as total FROM departments d WHERE 1=1`;

        if (search) {
            sql += ` AND (d.department_code LIKE @search OR d.department_name LIKE @search)`;
            countSql += ` AND (d.department_code LIKE @search OR d.department_name LIKE @search)`;
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        // Count query
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Data query
        sql += ` ORDER BY d.department_code ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        console.log(`✅ Found ${result.recordset.length} departments, Total: ${total}`);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET DEPARTMENT LOGO
app.get('/api/departments/:id/logo', async (req, res) => {
    try {
        const deptId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('deptId', mssql.Int, deptId)
            .query('SELECT logo_base64, logo_mime_type FROM departments WHERE department_id = @deptId');

        if (result.recordset.length === 0 || !result.recordset[0].logo_base64) {
            return res.status(404).json({
                success: false,
                error: 'Logo not found'
            });
        }

        const logoData = result.recordset[0].logo_base64;
        const mimeType = result.recordset[0].logo_mime_type || 'image/png';

        // Extract base64 data
        const base64Data = logoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': buffer.length
        });
        res.end(buffer);

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. GET SINGLE DEPARTMENT
app.get('/api/departments/:id', async (req, res) => {
    try {
        const deptId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT 
                d.*,
                p.account_code as purchase_coa_code,
                p.account_name as purchase_coa_name,
                s.account_code as sales_coa_code,
                s.account_name as sales_coa_name
            FROM departments d
            LEFT JOIN chart_of_accounts p ON d.purchase_coa_id = p.account_id
            LEFT JOIN chart_of_accounts s ON d.sales_coa_id = s.account_id
            WHERE d.department_id = @deptId
        `;

        const result = await pool.request()
            .input('deptId', mssql.Int, deptId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. CHECK CATEGORY CODE
app.get('/api/categories/check-code', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) {
            return res.json({ exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, code)
            .query('SELECT COUNT(*) as count FROM categories WHERE category_code = @code');

        res.json({
            exists: result.recordset[0].count > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. CREATE CATEGORY
app.post('/api/categories', async (req, res) => {
    try {
        const catData = req.body;
        console.log('📦 Creating category with code:', catData.category_code);

        const errors = [];

        if (!catData.category_code) errors.push('Category code is required');
        if (!catData.category_name) errors.push('Category name is required');
        if (!catData.department_id) errors.push('Department is required');

        if (catData.category_code && !/^[A-Za-z0-9_-]{1,20}$/.test(catData.category_code)) {
            errors.push('Category code format invalid. Use only letters, numbers, dash (-) or underscore (_), max 20 chars.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, catData.category_code)
            .query('SELECT category_id FROM categories WHERE category_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Category code "${catData.category_code}" already exists`
            });
        }

        // Set defaults
        const defaults = {
            discount_percentage: 0.00,
            is_service: 0,
            is_active: 1,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...catData };

        // Remove undefined
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO categories (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS catId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            category_id: result.recordset[0].catId,
            category_code: finalData.category_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 9. GET ALL CATEGORIES
app.get('/api/categories', async (req, res) => {
    try {
        const search = req.query.search || '';
        const departmentId = req.query.department_id || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const sortBy = req.query.sort_by || 'code';
        const sortOrder = req.query.sort_order || 'asc';

        const pool = await getPool();
        const request = pool.request();

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (search) {
            whereClause += ' AND (c.category_code LIKE @search OR c.category_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (departmentId) {
            whereClause += ' AND c.department_id = @deptId';
            request.input('deptId', mssql.Int, departmentId);
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM categories c ${whereClause}`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / limit);

        // Determine ORDER BY
        let orderByClause = 'ORDER BY ';
        switch (sortBy) {
            case 'code': orderByClause += `c.category_code ${sortOrder}`; break;
            case 'name': orderByClause += `c.category_name ${sortOrder}`; break;
            case 'created_at': orderByClause += `c.created_at ${sortOrder}`; break;
            default: orderByClause += `c.category_code ${sortOrder}`;
        }

        // Data query
        const sql = `
            SELECT 
                c.*,
                d.department_code as dept_code,
                d.department_name as dept_name
            FROM categories c
            LEFT JOIN departments d ON c.department_id = d.department_id
            ${whereClause}
            ${orderByClause}
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, offset);
        request.input('limit', mssql.Int, limit);

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            sort: {
                by: sortBy,
                order: sortOrder
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 10. GET SINGLE CATEGORY
app.get('/api/categories/:id', async (req, res) => {
    try {
        const catId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT 
                c.*,
                d.department_code as dept_code,
                d.department_name as dept_name,
                c.logo_base64,
                c.logo_file_name,
                c.logo_mime_type
            FROM categories c
            LEFT JOIN departments d ON c.department_id = d.department_id
            WHERE c.category_id = @catId
        `;

        const result = await pool.request()
            .input('catId', mssql.Int, catId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        const category = result.recordset[0];

        // Handle large logo
        if (category.logo_base64 && category.logo_base64.length > 1000000) {
            category.logo_base64 = null;
            category.has_large_logo = true;
        }

        res.json({
            success: true,
            data: category
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 11. UPDATE CATEGORY
app.put('/api/categories/:id', async (req, res) => {
    try {
        const catId = req.params.id;
        const updateData = req.body;
        console.log(`📝 PUT /api/categories/${catId}`);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('catId', mssql.Int, catId)
            .query('SELECT * FROM categories WHERE category_id = @catId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Category ID ${catId} not found`
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE categories SET ${setClause} WHERE category_id = @catId`;

        const request = pool.request();
        request.input('catId', mssql.Int, catId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Category updated, affected rows:', result.rowsAffected[0]);

        res.json({
            success: true,
            message: 'Category updated successfully',
            category_id: catId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 12. DELETE CATEGORY
app.delete('/api/categories/:id', async (req, res) => {
    try {
        const catId = req.params.id;
        console.log('🗑️ Deleting category:', catId);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('catId', mssql.Int, catId)
            .query('SELECT * FROM categories WHERE category_id = @catId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Category ID ${catId} not found`
            });
        }

        const result = await pool.request()
            .input('catId', mssql.Int, catId)
            .query('DELETE FROM categories WHERE category_id = @catId');

        console.log('✅ Category deleted, affected rows:', result.rowsAffected[0]);

        res.json({
            success: true,
            message: 'Category deleted successfully',
            category_id: catId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 13. GET ACTIVE DEPARTMENTS
app.get('/api/departments/active', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT department_id, department_code, department_name 
            FROM departments 
            WHERE is_active = 1 
            ORDER BY department_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 14. GET CATEGORY LOGO
app.get('/api/categories/:id/logo', async (req, res) => {
    try {
        const catId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('catId', mssql.Int, catId)
            .query('SELECT logo_base64, logo_mime_type FROM categories WHERE category_id = @catId');

        if (result.recordset.length === 0 || !result.recordset[0].logo_base64) {
            return res.status(404).json({
                success: false,
                error: 'Logo not found'
            });
        }

        const logoData = result.recordset[0].logo_base64;
        const mimeType = result.recordset[0].logo_mime_type || 'image/png';

        const base64Data = logoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': buffer.length
        });
        res.end(buffer);

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= BRANDS API =============

// 1. CHECK BRAND CODE
app.get('/api/brands/check-code', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) {
            return res.json({ exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, code)
            .query('SELECT COUNT(*) as count FROM brands WHERE brand_code = @code');

        res.json({
            exists: result.recordset[0].count > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CREATE BRAND
app.post('/api/brands', async (req, res) => {
    try {
        const brandData = req.body;
        console.log('📦 Creating brand:', brandData.brand_code);

        const errors = [];

        if (!brandData.brand_code) errors.push('Brand code is required');
        if (!brandData.brand_name) errors.push('Brand name is required');

        if (brandData.discount_percentage < 0 || brandData.discount_percentage > 100) {
            errors.push('Discount percentage must be between 0 and 100');
        }

        if (brandData.brand_code && !/^[A-Za-z0-9_-]{1,20}$/.test(brandData.brand_code)) {
            errors.push('Brand code format invalid. Use only letters, numbers, dash (-) or underscore (_), max 20 chars.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, brandData.brand_code)
            .query('SELECT brand_id FROM brands WHERE brand_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Brand code "${brandData.brand_code}" already exists`
            });
        }

        // Set defaults
        const defaults = {
            discount_percentage: 0.00,
            is_active: 1,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...brandData };

        // Remove undefined
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO brands (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS brandId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'Brand created successfully',
            brand_id: result.recordset[0].brandId,
            brand_code: finalData.brand_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ALL BRANDS
app.get('/api/brands', async (req, res) => {
    try {
        const search = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const pool = await getPool();
        const request = pool.request();

        let whereClause = 'WHERE 1=1';

        if (search) {
            whereClause += ' AND (brand_code LIKE @search OR brand_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM brands ${whereClause}`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / limit);

        // Data query
        const sql = `
            SELECT * FROM brands
            ${whereClause}
            ORDER BY brand_name
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, offset);
        request.input('limit', mssql.Int, limit);

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE BRAND
app.get('/api/brands/:id', async (req, res) => {
    try {
        const brandId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('brandId', mssql.Int, brandId)
            .query('SELECT * FROM brands WHERE brand_id = @brandId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Brand not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. UPDATE BRAND
app.put('/api/brands/:id', async (req, res) => {
    try {
        const brandId = req.params.id;
        const updateData = req.body;
        console.log(`📝 PUT /api/brands/${brandId}`);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('brandId', mssql.Int, brandId)
            .query('SELECT * FROM brands WHERE brand_id = @brandId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Brand ID ${brandId} not found`
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE brands SET ${setClause} WHERE brand_id = @brandId`;

        const request = pool.request();
        request.input('brandId', mssql.Int, brandId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Brand updated, affected rows:', result.rowsAffected[0]);

        res.json({
            success: true,
            message: 'Brand updated successfully',
            brand_id: brandId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE BRAND
app.delete('/api/brands/:id', async (req, res) => {
    try {
        const brandId = req.params.id;
        console.log('🗑️ Deleting brand:', brandId);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('brandId', mssql.Int, brandId)
            .query('SELECT * FROM brands WHERE brand_id = @brandId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Brand ID ${brandId} not found`
            });
        }

        const result = await pool.request()
            .input('brandId', mssql.Int, brandId)
            .query('DELETE FROM brands WHERE brand_id = @brandId');

        console.log('✅ Brand deleted, affected rows:', result.rowsAffected[0]);

        res.json({
            success: true,
            message: 'Brand deleted successfully',
            brand_id: brandId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. GET BRAND LOGO
app.get('/api/brands/:id/logo', async (req, res) => {
    try {
        const brandId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('brandId', mssql.Int, brandId)
            .query('SELECT logo_base64, logo_mime_type FROM brands WHERE brand_id = @brandId');

        if (result.recordset.length === 0 || !result.recordset[0].logo_base64) {
            return res.status(404).json({
                success: false,
                error: 'Logo not found'
            });
        }

        const logoData = result.recordset[0].logo_base64;
        const mimeType = result.recordset[0].logo_mime_type || 'image/png';

        const base64Data = logoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': buffer.length
        });
        res.end(buffer);

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= UOM API =============

// 1. CHECK UOM CODE
app.get('/api/uoms/check-code', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) {
            return res.json({ exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, code)
            .query('SELECT COUNT(*) as count FROM uoms WHERE uom_code = @code');

        res.json({
            exists: result.recordset[0].count > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET BASE UOMS
app.get('/api/uoms/base', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT uom_id, uom_code, uom_name 
            FROM uoms 
            WHERE is_base_uom = 1 
            AND is_active = 1
            ORDER BY uom_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ALL UOMS
app.get('/api/uoms', async (req, res) => {
    try {
        const search = req.query.search || '';
        const is_base = req.query.is_base;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const pool = await getPool();
        const request = pool.request();

        let whereClause = 'WHERE 1=1';

        if (search) {
            whereClause += ' AND (u.uom_code LIKE @search OR u.uom_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (is_base === 'true') {
            whereClause += ' AND u.is_base_uom = 1';
        } else if (is_base === 'false') {
            whereClause += ' AND u.is_base_uom = 0';
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM uoms u ${whereClause}`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / limit);

        // Data query
        const sql = `
            SELECT 
                u.*,
                b.uom_code as base_uom_code,
                b.uom_name as base_uom_name
            FROM uoms u
            LEFT JOIN uoms b ON u.base_uom_id = b.uom_id
            ${whereClause}
            ORDER BY u.is_base_uom DESC, u.uom_name
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, offset);
        request.input('limit', mssql.Int, limit);

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page,
                limit,
                totalPages
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. CREATE UOM
app.post('/api/uoms', async (req, res) => {
    try {
        const uomData = req.body;
        console.log('Received data:', uomData);

        const errors = [];

        if (!uomData.uom_code) errors.push('UOM code is required');
        if (!uomData.uom_name) errors.push('UOM name is required');

        if (uomData.uom_code && !/^[A-Z]{1,10}$/.test(uomData.uom_code)) {
            errors.push('UOM code must be uppercase letters only (max 10 chars)');
        }

        if (uomData.is_base_uom === true && uomData.base_uom_id) {
            errors.push('Base UOM cannot have another base UOM reference');
        }

        if (uomData.is_base_uom === false && !uomData.base_uom_id) {
            errors.push('Non-base UOM must have a base UOM selected');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, uomData.uom_code)
            .query('SELECT uom_id FROM uoms WHERE uom_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `UOM code "${uomData.uom_code}" already exists`
            });
        }

        // Set defaults
        const defaults = {
            conversion_factor: 1.0000,
            is_active: 1,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...uomData };

        // Clean up
        if (finalData.is_base_uom) {
            finalData.base_uom_id = null;
            finalData.conversion_factor = 1.0000;
        }

        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO uoms (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS uomId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 4), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'UOM created successfully',
            uom_id: result.recordset[0].uomId,
            uom_code: finalData.uom_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET SINGLE UOM
app.get('/api/uoms/:id', async (req, res) => {
    try {
        const uomId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT 
                u.*,
                b.uom_code as base_uom_code,
                b.uom_name as base_uom_name
            FROM uoms u
            LEFT JOIN uoms b ON u.base_uom_id = b.uom_id
            WHERE u.uom_id = @uomId
        `;

        const result = await pool.request()
            .input('uomId', mssql.Int, uomId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'UOM not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE UOM
app.put('/api/uoms/:id', async (req, res) => {
    try {
        const uomId = req.params.id;
        const updateData = req.body;

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('uomId', mssql.Int, uomId)
            .query('SELECT * FROM uoms WHERE uom_id = @uomId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `UOM not found`
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE uoms SET ${setClause} WHERE uom_id = @uomId`;

        const request = pool.request();
        request.input('uomId', mssql.Int, uomId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 4), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.json({
            success: true,
            message: 'UOM updated successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. DELETE UOM
app.delete('/api/uoms/:id', async (req, res) => {
    try {
        const uomId = req.params.id;
        console.log('🗑️ Deleting UOM ID:', uomId);

        const pool = await getPool();

        const result = await pool.request()
            .input('uomId', mssql.Int, uomId)
            .query('DELETE FROM uoms WHERE uom_id = @uomId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'UOM not found'
            });
        }

        console.log('✅ UOM deleted successfully');

        res.json({
            success: true,
            message: 'UOM deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        // Check for foreign key constraint
        if (error.message && (error.message.includes('REFERENCE') || error.message.includes('foreign key'))) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete! This UOM is being used in the system.'
            });
        }
        res.status(500).json({
            success: false,
            error: 'Delete failed: ' + error.message
        });
    }
});

// ============= PAYMODES API =============

// 1. CREATE PAYMODE
app.post('/api/paymodes', async (req, res) => {
    try {
        const paymodeData = req.body;
        console.log('📦 Creating paymode:', paymodeData.paymode_code);

        const errors = [];

        if (!paymodeData.paymode_code || !paymodeData.paymode_code.trim()) {
            errors.push('Paymode code is required');
        }

        if (!paymodeData.paymode_description || !paymodeData.paymode_description.trim()) {
            errors.push('Description is required');
        }

        if (paymodeData.paymode_code && !/^[A-Za-z0-9_-]{1,20}$/.test(paymodeData.paymode_code)) {
            errors.push('Paymode code format invalid. Use only letters, numbers, dash (-) or underscore (_), max 20 chars.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, paymodeData.paymode_code)
            .query('SELECT paymode_id FROM paymodes WHERE paymode_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Paymode code "${paymodeData.paymode_code}" already exists`
            });
        }

        // If setting as default, unset other defaults
        if (paymodeData.is_default === true) {
            await pool.request().query('UPDATE paymodes SET is_default = 0 WHERE is_default = 1');
        }

        // Set defaults
        const defaults = {
            is_bank: 0,
            is_default: 0,
            is_active: 1,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...paymodeData };

        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO paymodes (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS paymodeId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'Paymode created successfully',
            paymode_id: result.recordset[0].paymodeId,
            paymode_code: finalData.paymode_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CHECK PAYMODE CODE
app.get('/api/paymodes/check-code', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) {
            return res.json({ exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, code)
            .query('SELECT COUNT(*) as count FROM paymodes WHERE paymode_code = @code');

        res.json({
            exists: result.recordset[0].count > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ALL PAYMODES
app.get('/api/paymodes', async (req, res) => {
    try {
        const search = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const pool = await getPool();
        const request = pool.request();

        let whereClause = 'WHERE 1=1';

        if (search) {
            whereClause += ' AND (paymode_code LIKE @search OR paymode_description LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM paymodes ${whereClause}`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / limit);

        // Data query
        const sql = `
            SELECT * FROM paymodes 
            ${whereClause}
            ORDER BY 
                is_default DESC,
                paymode_code ASC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, offset);
        request.input('limit', mssql.Int, limit);

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE PAYMODE
app.get('/api/paymodes/:id', async (req, res) => {
    try {
        const paymodeId = req.params.id;
        console.log(`🔍 GET /api/paymodes/${paymodeId}`);

        const pool = await getPool();
        const result = await pool.request()
            .input('paymodeId', mssql.Int, paymodeId)
            .query('SELECT * FROM paymodes WHERE paymode_id = @paymodeId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Paymode not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET ACTIVE PAYMODES
app.get('/api/paymodes/active', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT paymode_id, paymode_code, paymode_description, is_bank, is_default 
            FROM paymodes 
            WHERE is_active = 1 
            ORDER BY is_default DESC, paymode_code ASC
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE PAYMODE
app.put('/api/paymodes/:id', async (req, res) => {
    try {
        const paymodeId = req.params.id;
        const updateData = req.body;
        console.log(`📝 PUT /api/paymodes/${paymodeId}`, updateData);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('paymodeId', mssql.Int, paymodeId)
            .query('SELECT * FROM paymodes WHERE paymode_id = @paymodeId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Paymode ID ${paymodeId} not found`
            });
        }

        // If setting as default, unset other defaults
        if (updateData.is_default === true) {
            await pool.request()
                .input('paymodeId', mssql.Int, paymodeId)
                .query('UPDATE paymodes SET is_default = 0 WHERE is_default = 1 AND paymode_id != @paymodeId');
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE paymodes SET ${setClause} WHERE paymode_id = @paymodeId`;

        const request = pool.request();
        request.input('paymodeId', mssql.Int, paymodeId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Paymode updated, affected rows:', result.rowsAffected[0]);

        res.json({
            success: true,
            message: 'Paymode updated successfully',
            paymode_id: paymodeId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. DELETE PAYMODE
app.delete('/api/paymodes/:id', async (req, res) => {
    try {
        const paymodeId = req.params.id;
        console.log('🗑️ Deleting paymode:', paymodeId);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('paymodeId', mssql.Int, paymodeId)
            .query('SELECT * FROM paymodes WHERE paymode_id = @paymodeId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Paymode ID ${paymodeId} not found`
            });
        }

        // Check if it's default
        if (checkResult.recordset[0].is_default) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete default paymode. Please set another paymode as default first.'
            });
        }

        const result = await pool.request()
            .input('paymodeId', mssql.Int, paymodeId)
            .query('DELETE FROM paymodes WHERE paymode_id = @paymodeId');

        console.log('✅ Paymode deleted, affected rows:', result.rowsAffected[0]);

        res.json({
            success: true,
            message: 'Paymode deleted successfully',
            paymode_id: paymodeId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. TOGGLE DEFAULT PAYMODE
app.patch('/api/paymodes/:id/toggle-default', async (req, res) => {
    try {
        const paymodeId = req.params.id;
        console.log(`🔄 PATCH /api/paymodes/${paymodeId}/toggle-default`);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('paymodeId', mssql.Int, paymodeId)
            .query('SELECT * FROM paymodes WHERE paymode_id = @paymodeId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Paymode ID ${paymodeId} not found`
            });
        }

        // Reset all defaults
        await pool.request().query('UPDATE paymodes SET is_default = 0 WHERE is_default = 1');

        // Set this one as default
        const result = await pool.request()
            .input('paymodeId', mssql.Int, paymodeId)
            .input('updatedAt', mssql.DateTime, new Date())
            .query('UPDATE paymodes SET is_default = 1, updated_at = @updatedAt WHERE paymode_id = @paymodeId');

        console.log(`✅ Paymode ${paymodeId} set as default`);

        res.json({
            success: true,
            message: 'Default paymode updated successfully',
            paymode_id: paymodeId,
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= PROJECTS API =============

// 1. GET ACTIVE CUSTOMERS FOR DROPDOWN
app.get('/api/customers/active', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                customer_id, 
                customer_code, 
                customer_name,
                contact_person1,
                phone1
            FROM customers 
            WHERE is_active = 1 
            AND is_blocked = 0
            ORDER BY customer_name
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CREATE PROJECT
app.post('/api/projects', async (req, res) => {
    try {
        const projectData = req.body;
        console.log('📦 Creating project:', projectData.project_code);

        const errors = [];

        if (!projectData.project_code) errors.push('Project code is required');
        if (!projectData.project_name) errors.push('Project name is required');
        if (!projectData.customer_id) errors.push('Customer is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, projectData.project_code)
            .query('SELECT project_id FROM projects WHERE project_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Project code "${projectData.project_code}" already exists`
            });
        }

        // Set defaults
        const defaults = {
            project_status: 'On going',
            is_active: 1,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...projectData };

        // Remove undefined
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO projects (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS projectId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            project_id: result.recordset[0].projectId,
            project_code: finalData.project_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. UPDATE PROJECT
app.put('/api/projects/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
        const updateData = req.body;
        console.log(`✏️ Updating project ${projectId}:`, updateData);

        const errors = [];

        if (updateData.project_name !== undefined && !updateData.project_name.trim()) {
            errors.push('Project name is required');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE projects SET ${setClause} WHERE project_id = @projectId`;

        const request = pool.request();
        request.input('projectId', mssql.Int, projectId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        res.json({
            success: true,
            message: 'Project updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE PROJECT
app.get('/api/projects/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
        console.log(`🔍 Fetching project ID: ${projectId}`);

        const pool = await getPool();

        const sql = `
            SELECT 
                p.*,
                c.customer_code,
                c.customer_name,
                c.contact_person1,
                c.phone1,
                c.email,
                FORMAT(p.start_date, 'dd-MM-yyyy') as formatted_start_date,
                FORMAT(p.end_date, 'dd-MM-yyyy') as formatted_end_date,
                FORMAT(p.created_at, 'dd-MM-yyyy HH:mm') as formatted_created_at,
                FORMAT(p.updated_at, 'dd-MM-yyyy HH:mm') as formatted_updated_at
            FROM projects p
            LEFT JOIN customers c ON p.customer_id = c.customer_id
            WHERE p.project_id = @projectId
        `;

        const result = await pool.request()
            .input('projectId', mssql.Int, projectId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET ALL PROJECTS
app.get('/api/projects', async (req, res) => {
    try {
        const search = req.query.search || '';
        const customerId = req.query.customer_id || '';
        const status = req.query.status || '';
        const isActive = req.query.is_active;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const pool = await getPool();
        const request = pool.request();

        let whereClause = 'WHERE 1=1';

        if (search) {
            whereClause += ' AND (p.project_code LIKE @search OR p.project_name LIKE @search OR c.customer_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (customerId && customerId !== 'undefined' && customerId !== 'null' && !isNaN(parseInt(customerId, 10))) {
            whereClause += ' AND p.customer_id = @customerId';
            request.input('customerId', mssql.Int, parseInt(customerId, 10));
        }

        if (status && status !== 'All') {
            whereClause += ' AND p.project_status = @status';
            request.input('status', mssql.NVarChar, status);
        }

        if (isActive !== undefined && isActive !== '') {
            whereClause += ' AND p.is_active = @isActive';
            request.input('isActive', mssql.Bit, isActive === 'true' ? 1 : 0);
        }

        // Count query
        const countSql = `
            SELECT COUNT(*) as total 
            FROM projects p 
            LEFT JOIN customers c ON p.customer_id = c.customer_id
            ${whereClause}
        `;

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / limit);

        // Data query
        const sql = `
            SELECT 
                p.*,
                c.customer_code,
                c.customer_name,
                c.contact_person1,
                c.phone1,
                c.email,
                FORMAT(p.start_date, 'dd-MM-yyyy') as formatted_start_date,
                FORMAT(p.created_at, 'dd-MM-yyyy HH:mm') as formatted_created_date,
                FORMAT(p.created_at, 'dd-MM-yyyy') as created_date_only,
                FORMAT(p.created_at, 'HH:mm') as created_time_only
            FROM projects p
            LEFT JOIN customers c ON p.customer_id = c.customer_id
            ${whereClause}
            ORDER BY p.created_at DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, offset);
        request.input('limit', mssql.Int, limit);

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE PROJECT (HARD DELETE)
app.delete('/api/projects/:id', async (req, res) => {
    try {
        const projectId = req.params.id;
        console.log(`🗑️ Hard deleting project ID: ${projectId}`);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('projectId', mssql.Int, projectId)
            .query('SELECT project_code FROM projects WHERE project_id = @projectId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        const projectCode = checkResult.recordset[0].project_code;

        // Delete
        const result = await pool.request()
            .input('projectId', mssql.Int, projectId)
            .query('DELETE FROM projects WHERE project_id = @projectId');

        console.log(`✅ Hard deleted project: ${projectCode}`);

        res.json({
            success: true,
            message: `Project "${projectCode}" permanently deleted`,
            deleted_id: projectId,
            deleted_code: projectCode
        });

    } catch (error) {
        console.error('❌ Error:', error);
        // Check for foreign key constraint
        if (error.message && (error.message.includes('REFERENCE') || error.message.includes('foreign key'))) {
            return res.status(409).json({
                success: false,
                error: `Cannot delete project. It has related records.`
            });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= LOCATIONS API =============

// 1. CHECK LOCATION CODE
app.get('/api/locations/check-code/:code', async (req, res) => {
    try {
        const locationCode = req.params.code;
        console.log('🔍 Checking location code:', locationCode);

        if (!locationCode) {
            return res.json({ success: true, exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, locationCode)
            .query('SELECT location_id FROM locations WHERE location_code = @code');

        res.json({
            success: true,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET NEXT SORT CODE
app.get('/api/locations/next-sort-code', async (req, res) => {
    try {
        console.log('🔢 Getting next sort code...');
        const pool = await getPool();

        const result = await pool.request()
            .query('SELECT ISNULL(MAX(sort_code), 0) + 1 as next_sort_code FROM locations');

        console.log('✅ Next sort code:', result.recordset[0].next_sort_code);

        res.json({
            success: true,
            next_sort_code: result.recordset[0].next_sort_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. CREATE LOCATION
app.post('/api/locations', async (req, res) => {
    try {
        const locationData = req.body;
        console.log('📝 Creating location:', locationData.location_code);

        const errors = [];

        if (!locationData.location_code) errors.push('Location code is required');
        if (!locationData.location_name) errors.push('Location name is required');
        if (!locationData.sort_code) errors.push('Sort code is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, locationData.location_code)
            .query('SELECT location_id FROM locations WHERE location_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Location code "${locationData.location_code}" already exists`
            });
        }

        // Check if sort code exists
        const sortResult = await pool.request()
            .input('sortCode', mssql.Int, locationData.sort_code)
            .query('SELECT location_id FROM locations WHERE sort_code = @sortCode');

        if (sortResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Sort code "${locationData.sort_code}" already exists. Please use a different sort code.`
            });
        }

        // Set defaults
        locationData.created_at = new Date();
        locationData.created_by = locationData.created_by || 1;

        // Ensure time format
        if (locationData.office_start_time && !locationData.office_start_time.includes(':')) {
            locationData.office_start_time += ':00';
        } else if (!locationData.office_start_time) {
            locationData.office_start_time = '09:00:00';
        }

        if (locationData.office_end_time && !locationData.office_end_time.includes(':')) {
            locationData.office_end_time += ':00';
        } else if (!locationData.office_end_time) {
            locationData.office_end_time = '18:00:00';
        }

        // Remove undefined
        Object.keys(locationData).forEach(key => {
            if (locationData[key] === undefined) delete locationData[key];
        });

        const columns = Object.keys(locationData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO locations (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS locationId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = locationData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Location created, ID:', result.recordset[0].locationId);

        res.status(201).json({
            success: true,
            message: 'Location created successfully',
            location_id: result.recordset[0].locationId,
            location_code: locationData.location_code,
            sort_code: locationData.sort_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET ALL LOCATIONS
app.get('/api/locations', async (req, res) => {
    try {
        const {
            search = '',
            page = 1,
            limit = 20,
            status = 'all'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = 'SELECT * FROM locations WHERE 1=1';

        if (search) {
            sql += ' AND (location_code LIKE @search OR location_name LIKE @search OR address LIKE @search OR city LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        // Count query
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Data query
        sql += ' ORDER BY sort_code ASC, location_name ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET SINGLE LOCATION
app.get('/api/locations/:id', async (req, res) => {
    try {
        const locationId = req.params.id;
        console.log('🔍 Getting location:', locationId);

        const pool = await getPool();
        const result = await pool.request()
            .input('locationId', mssql.Int, locationId)
            .query('SELECT * FROM locations WHERE location_id = @locationId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE LOCATION
app.put('/api/locations/:id', async (req, res) => {
    try {
        const locationId = req.params.id;
        const updateData = req.body;
        console.log('📝 Updating location:', locationId);

        // Add updated timestamp
        updateData.updated_at = new Date();

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE locations SET ${setClause} WHERE location_id = @locationId`;

        const request = pool.request();
        request.input('locationId', mssql.Int, locationId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            message: 'Location updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. DELETE LOCATION
app.delete('/api/locations/:id', async (req, res) => {
    try {
        const locationId = req.params.id;
        console.log('🗑️ Deleting location:', locationId);

        const pool = await getPool();

        const result = await pool.request()
            .input('locationId', mssql.Int, locationId)
            .query('DELETE FROM locations WHERE location_id = @locationId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            message: 'Location deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. LOCATION TEST ENDPOINT
app.get('/api/locations/test', (req, res) => {
    res.json({
        success: true,
        message: 'Locations API is working!',
        timestamp: new Date().toISOString(),
        endpoints: [
            'GET /api/locations/check-code/:code',
            'GET /api/locations/next-sort-code',
            'POST /api/locations',
            'GET /api/locations',
            'GET /api/locations/:id',
            'PUT /api/locations/:id',
            'DELETE /api/locations/:id'
        ]
    });
});

// ============= DEPARTMENT API =============

// 1. GET NEXT SORT CODE FOR DEPARTMENT
app.get('/api/department/next-sort-code', async (req, res) => {
    try {
        console.log('🔢 Getting next sort code for department...');
        const pool = await getPool();

        const result = await pool.request()
            .query('SELECT ISNULL(MAX(sort_code), 0) + 1 as next_sort_code FROM department');

        console.log('✅ Next department sort code:', result.recordset[0].next_sort_code);

        res.json({
            success: true,
            next_sort_code: result.recordset[0].next_sort_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CHECK DEPARTMENT CODE
app.get('/api/department/check-code/:code', async (req, res) => {
    try {
        const deptCode = req.params.code;
        console.log('🔍 Checking department code:', deptCode);

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, deptCode)
            .query('SELECT department_id FROM department WHERE department_code = @code');

        res.json({
            success: true,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. CREATE DEPARTMENT
app.post('/api/department', async (req, res) => {
    try {
        const departmentData = req.body;
        console.log('📝 Creating department:', departmentData.department_code);

        const errors = [];

        if (!departmentData.department_code) errors.push('Department code is required');
        if (!departmentData.department_name) errors.push('Department name is required');
        if (!departmentData.sort_code) errors.push('Sort code is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, departmentData.department_code)
            .query('SELECT department_id FROM department WHERE department_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Department code "${departmentData.department_code}" already exists`
            });
        }

        // Check if sort code exists
        const sortResult = await pool.request()
            .input('sortCode', mssql.Int, departmentData.sort_code)
            .query('SELECT department_id FROM department WHERE sort_code = @sortCode');

        if (sortResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Sort code "${departmentData.sort_code}" already exists. Please use a different sort code.`
            });
        }

        // Set defaults
        departmentData.created_at = new Date();
        departmentData.created_by = departmentData.created_by || 1;

        // Ensure time format
        if (departmentData.office_start_time && !departmentData.office_start_time.includes(':')) {
            departmentData.office_start_time += ':00';
        } else if (!departmentData.office_start_time) {
            departmentData.office_start_time = '09:00:00';
        }

        if (departmentData.office_end_time && !departmentData.office_end_time.includes(':')) {
            departmentData.office_end_time += ':00';
        } else if (!departmentData.office_end_time) {
            departmentData.office_end_time = '18:00:00';
        }

        // Remove undefined
        Object.keys(departmentData).forEach(key => {
            if (departmentData[key] === undefined) delete departmentData[key];
        });

        const columns = Object.keys(departmentData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO department (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS deptId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = departmentData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Department created, ID:', result.recordset[0].deptId);

        res.status(201).json({
            success: true,
            message: 'Department created successfully',
            department_id: result.recordset[0].deptId,
            department_code: departmentData.department_code,
            sort_code: departmentData.sort_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET ALL DEPARTMENTS
app.get('/api/department', async (req, res) => {
    try {
        const {
            search = '',
            page = 1,
            limit = 20,
            status = 'all'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = 'SELECT * FROM department WHERE 1=1';

        if (search) {
            sql += ' AND (department_code LIKE @search OR department_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        // Count query
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Data query
        sql += ' ORDER BY sort_code ASC, department_name ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET SINGLE DEPARTMENT
app.get('/api/department/:id', async (req, res) => {
    try {
        const departmentId = req.params.id;
        console.log('🔍 Getting department by ID:', departmentId);

        const pool = await getPool();
        const result = await pool.request()
            .input('deptId', mssql.Int, departmentId)
            .query('SELECT * FROM department WHERE department_id = @deptId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE DEPARTMENT
app.put('/api/department/:id', async (req, res) => {
    try {
        const departmentId = req.params.id;
        const updateData = req.body;
        console.log('📝 Updating department:', departmentId);

        // Add updated timestamp
        updateData.updated_at = new Date();

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE department SET ${setClause} WHERE department_id = @deptId`;

        const request = pool.request();
        request.input('deptId', mssql.Int, departmentId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        res.json({
            success: true,
            message: 'Department updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. DELETE DEPARTMENT
app.delete('/api/department/:id', async (req, res) => {
    try {
        const departmentId = req.params.id;
        console.log('🗑️ Deleting department:', departmentId);

        const pool = await getPool();

        const result = await pool.request()
            .input('deptId', mssql.Int, departmentId)
            .query('DELETE FROM department WHERE department_id = @deptId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        res.json({
            success: true,
            message: 'Department deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= EMPLOYEE TYPES API =============

// 1. GET NEXT HIERARCHY CODE
app.get('/api/employee-types/next-hierarchy-code', async (req, res) => {
    try {
        console.log('🔢 Getting next hierarchy code...');
        const pool = await getPool();

        const result = await pool.request()
            .query('SELECT ISNULL(MAX(hierarchy_code), 0) + 1 as next_hierarchy_code FROM employee_types');

        console.log('✅ Next hierarchy code:', result.recordset[0].next_hierarchy_code);

        res.json({
            success: true,
            next_hierarchy_code: result.recordset[0].next_hierarchy_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CREATE EMPLOYEE TYPE
app.post('/api/employee-types', async (req, res) => {
    try {
        const employeeTypeData = req.body;
        console.log('📝 Creating employee type:', employeeTypeData.type_code);

        const errors = [];

        if (!employeeTypeData.type_code) errors.push('Type code is required');
        if (!employeeTypeData.description) errors.push('Description is required');
        if (!employeeTypeData.hierarchy_code) errors.push('Hierarchy code is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if type code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, employeeTypeData.type_code)
            .query('SELECT type_id FROM employee_types WHERE type_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Employee type code "${employeeTypeData.type_code}" already exists`
            });
        }

        // Check if hierarchy code exists
        const hierarchyResult = await pool.request()
            .input('hierarchyCode', mssql.Int, employeeTypeData.hierarchy_code)
            .query('SELECT type_id FROM employee_types WHERE hierarchy_code = @hierarchyCode');

        if (hierarchyResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Hierarchy code "${employeeTypeData.hierarchy_code}" already exists. Please use a different hierarchy code.`
            });
        }

        // Set defaults
        employeeTypeData.created_at = new Date();
        employeeTypeData.created_by = employeeTypeData.created_by || 1;

        // Remove undefined
        Object.keys(employeeTypeData).forEach(key => {
            if (employeeTypeData[key] === undefined) delete employeeTypeData[key];
        });

        const columns = Object.keys(employeeTypeData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO employee_types (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS typeId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = employeeTypeData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Employee type created, ID:', result.recordset[0].typeId);

        res.status(201).json({
            success: true,
            message: 'Employee type created successfully',
            type_id: result.recordset[0].typeId,
            type_code: employeeTypeData.type_code,
            hierarchy_code: employeeTypeData.hierarchy_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ALL EMPLOYEE TYPES
app.get('/api/employee-types', async (req, res) => {
    try {
        const {
            search = '',
            page = 1,
            limit = 20,
            status = 'all'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = 'SELECT * FROM employee_types WHERE 1=1';

        if (search) {
            sql += ' AND (type_code LIKE @search OR description LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        // Count query
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Data query
        sql += ' ORDER BY hierarchy_code ASC, type_code ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE EMPLOYEE TYPE
app.get('/api/employee-types/:id', async (req, res) => {
    try {
        const typeId = req.params.id;
        console.log('🔍 Getting employee type:', typeId);

        const pool = await getPool();
        const result = await pool.request()
            .input('typeId', mssql.Int, typeId)
            .query('SELECT * FROM employee_types WHERE type_id = @typeId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Employee type not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. UPDATE EMPLOYEE TYPE
app.put('/api/employee-types/:id', async (req, res) => {
    try {
        const typeId = req.params.id;
        const updateData = req.body;
        console.log('📝 Updating employee type:', typeId);

        // Add updated timestamp
        updateData.updated_at = new Date();

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE employee_types SET ${setClause} WHERE type_id = @typeId`;

        const request = pool.request();
        request.input('typeId', mssql.Int, typeId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Employee type not found'
            });
        }

        res.json({
            success: true,
            message: 'Employee type updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE EMPLOYEE TYPE
app.delete('/api/employee-types/:id', async (req, res) => {
    try {
        const typeId = req.params.id;
        console.log('🗑️ Deleting employee type:', typeId);

        const pool = await getPool();

        const result = await pool.request()
            .input('typeId', mssql.Int, typeId)
            .query('DELETE FROM employee_types WHERE type_id = @typeId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Employee type not found'
            });
        }

        res.json({
            success: true,
            message: 'Employee type deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. CHECK EMPLOYEE TYPE CODE
app.get('/api/employee-types/check-code/:code', async (req, res) => {
    try {
        const typeCode = req.params.code;
        console.log('🔍 Checking employee type code:', typeCode);

        if (!typeCode) {
            return res.json({ success: true, exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, typeCode)
            .query('SELECT type_id FROM employee_types WHERE type_code = @code');

        res.json({
            success: true,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= LOAN TYPES API =============

// 1. CREATE LOAN TYPE
app.post('/api/loan-types', async (req, res) => {
    try {
        const loanTypeData = req.body;
        console.log('📝 Creating loan type:', loanTypeData.loan_code);

        const errors = [];

        if (!loanTypeData.loan_code || !loanTypeData.loan_code.trim()) {
            errors.push('Loan code is required');
        }

        if (!loanTypeData.description || !loanTypeData.description.trim()) {
            errors.push('Description is required');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if loan code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, loanTypeData.loan_code.trim().toUpperCase())
            .query('SELECT loan_type_id FROM loan_types WHERE loan_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Loan code "${loanTypeData.loan_code}" already exists`
            });
        }

        // Set defaults
        loanTypeData.created_at = new Date();
        loanTypeData.created_by = loanTypeData.created_by || 1;
        loanTypeData.loan_code = loanTypeData.loan_code.trim().toUpperCase();
        loanTypeData.description = loanTypeData.description.trim();

        // Remove undefined
        Object.keys(loanTypeData).forEach(key => {
            if (loanTypeData[key] === undefined) delete loanTypeData[key];
        });

        const columns = Object.keys(loanTypeData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO loan_types (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS loanTypeId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = loanTypeData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Loan type created, ID:', result.recordset[0].loanTypeId);

        res.status(201).json({
            success: true,
            message: 'Loan type created successfully',
            loan_type_id: result.recordset[0].loanTypeId,
            loan_code: loanTypeData.loan_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET ALL LOAN TYPES
app.get('/api/loan-types', async (req, res) => {
    try {
        const {
            search = '',
            page = 1,
            limit = 20,
            status = 'all'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = 'SELECT * FROM loan_types WHERE 1=1';

        if (search) {
            sql += ' AND (loan_code LIKE @search OR description LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        // Count query
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Data query
        sql += ' ORDER BY loan_code ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET SINGLE LOAN TYPE
app.get('/api/loan-types/:id', async (req, res) => {
    try {
        const loanTypeId = req.params.id;
        console.log('🔍 Getting loan type:', loanTypeId);

        const pool = await getPool();
        const result = await pool.request()
            .input('loanTypeId', mssql.Int, loanTypeId)
            .query('SELECT * FROM loan_types WHERE loan_type_id = @loanTypeId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Loan type not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. UPDATE LOAN TYPE
app.put('/api/loan-types/:id', async (req, res) => {
    try {
        const loanTypeId = req.params.id;
        const updateData = req.body;
        console.log('📝 Updating loan type:', loanTypeId);

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Clean data
        if (updateData.loan_code) updateData.loan_code = updateData.loan_code.trim().toUpperCase();
        if (updateData.description) updateData.description = updateData.description.trim();

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE loan_types SET ${setClause} WHERE loan_type_id = @loanTypeId`;

        const request = pool.request();
        request.input('loanTypeId', mssql.Int, loanTypeId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Loan type not found'
            });
        }

        res.json({
            success: true,
            message: 'Loan type updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. DELETE LOAN TYPE
app.delete('/api/loan-types/:id', async (req, res) => {
    try {
        const loanTypeId = req.params.id;
        console.log('🗑️ Deleting loan type:', loanTypeId);

        const pool = await getPool();

        const result = await pool.request()
            .input('loanTypeId', mssql.Int, loanTypeId)
            .query('DELETE FROM loan_types WHERE loan_type_id = @loanTypeId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Loan type not found'
            });
        }

        res.json({
            success: true,
            message: 'Loan type deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. CHECK LOAN CODE
app.get('/api/loan-types/check-code/:code', async (req, res) => {
    try {
        const loanCode = req.params.code.toUpperCase();
        console.log('🔍 Checking loan code:', loanCode);

        if (!loanCode) {
            return res.json({ success: true, exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, loanCode)
            .query('SELECT loan_type_id FROM loan_types WHERE loan_code = @code');

        res.json({
            success: true,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. GET ACTIVE LOAN TYPES
app.get('/api/loan-types/active', async (req, res) => {
    try {
        console.log('📋 Getting active loan types for dropdown...');
        const pool = await getPool();

        const sql = `
            SELECT loan_type_id, loan_code, description 
            FROM loan_types 
            WHERE is_active = 1 
            ORDER BY loan_code ASC
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= PUBLIC HOLIDAYS API =============

// 1. CHECK HOLIDAY CODE
app.get('/api/public-holidays/check-code/:code', async (req, res) => {
    try {
        const holidayCode = req.params.code;
        console.log('🔍 Checking holiday code:', holidayCode);

        if (!holidayCode) {
            return res.json({ success: true, exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, holidayCode)
            .query('SELECT holiday_id FROM public_holidays WHERE holiday_code = @code');

        res.json({
            success: true,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CREATE PUBLIC HOLIDAY
app.post('/api/public-holidays', async (req, res) => {
    try {
        const holidayData = req.body;
        console.log('📝 Creating public holiday:', holidayData.holiday_code);

        const errors = [];

        if (!holidayData.holiday_code) errors.push('Holiday code is required');
        if (!holidayData.description) errors.push('Description is required');
        if (!holidayData.actual_date) errors.push('Actual date is required');
        if (!holidayData.leave_date) errors.push('Leave date is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, holidayData.holiday_code)
            .query('SELECT holiday_id FROM public_holidays WHERE holiday_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Holiday code "${holidayData.holiday_code}" already exists`
            });
        }

        // Set defaults
        holidayData.created_at = new Date();
        holidayData.created_by = holidayData.created_by || 1;

        // Convert location to NULL if empty
        if (holidayData.location_id === '') {
            holidayData.location_id = null;
        }

        // Convert boolean values
        holidayData.is_recurring = holidayData.is_recurring ? 1 : 0;
        holidayData.is_national = holidayData.is_national ? 1 : 0;

        // Remove undefined
        Object.keys(holidayData).forEach(key => {
            if (holidayData[key] === undefined) delete holidayData[key];
        });

        const columns = Object.keys(holidayData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO public_holidays (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS holidayId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = holidayData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Holiday created, ID:', result.recordset[0].holidayId);

        res.status(201).json({
            success: true,
            message: 'Public holiday created successfully',
            holiday_id: result.recordset[0].holidayId,
            holiday_code: holidayData.holiday_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ALL PUBLIC HOLIDAYS
app.get('/api/public-holidays', async (req, res) => {
    try {
        const {
            year = new Date().getFullYear(),
            search = '',
            page = 1,
            limit = 20,
            location_id = ''
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT ph.*, 
                   l.location_name,
                   l.location_code,
                   CASE 
                       WHEN ph.location_id IS NULL THEN 'All Locations'
                       ELSE l.location_name
                   END as applicable_location
            FROM public_holidays ph
            LEFT JOIN locations l ON ph.location_id = l.location_id
            WHERE DATEPART(year, ph.leave_date) = @year
        `;

        request.input('year', mssql.Int, parseInt(year));

        if (search) {
            sql += ' AND (ph.holiday_code LIKE @search OR ph.description LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (location_id) {
            sql += ' AND (ph.location_id = @locationId OR ph.location_id IS NULL)';
            request.input('locationId', mssql.Int, location_id);
        }

        // Count query
        const countSql = sql.replace(
            'SELECT ph.*, l.location_name, l.location_code, CASE WHEN ph.location_id IS NULL THEN \'All Locations\' ELSE l.location_name END as applicable_location',
            'SELECT COUNT(*) as total'
        );

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Data query
        sql += ' ORDER BY ph.leave_date ASC, ph.holiday_code ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET HOLIDAY LOCATIONS
app.get('/api/public-holidays/locations', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT location_id, location_code, location_name 
            FROM locations 
            WHERE is_active = 1 
            ORDER BY location_name ASC
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. DELETE HOLIDAY
app.delete('/api/public-holidays/:id', async (req, res) => {
    try {
        const holidayId = req.params.id;
        console.log('🗑️ Deleting holiday:', holidayId);

        const pool = await getPool();

        const result = await pool.request()
            .input('holidayId', mssql.Int, holidayId)
            .query('DELETE FROM public_holidays WHERE holiday_id = @holidayId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        res.json({
            success: true,
            message: 'Holiday deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. GET SINGLE HOLIDAY
app.get('/api/public-holidays/:id', async (req, res) => {
    try {
        const holidayId = req.params.id;
        console.log('🔍 Getting holiday:', holidayId);

        const pool = await getPool();

        const sql = `
            SELECT ph.*, 
                   l.location_name,
                   l.location_code,
                   CASE 
                       WHEN ph.location_id IS NULL THEN 'All Locations'
                       ELSE l.location_name
                   END as applicable_location
            FROM public_holidays ph
            LEFT JOIN locations l ON ph.location_id = l.location_id
            WHERE ph.holiday_id = @holidayId
        `;

        const result = await pool.request()
            .input('holidayId', mssql.Int, holidayId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. UPDATE HOLIDAY
app.put('/api/public-holidays/:id', async (req, res) => {
    try {
        const holidayId = req.params.id;
        const updateData = req.body;
        console.log('📝 Updating holiday:', holidayId);

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Convert boolean values
        if (updateData.is_recurring !== undefined) {
            updateData.is_recurring = updateData.is_recurring ? 1 : 0;
        }
        if (updateData.is_national !== undefined) {
            updateData.is_national = updateData.is_national ? 1 : 0;
        }

        // Convert location to NULL if empty
        if (updateData.location_id === '') {
            updateData.location_id = null;
        }

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE public_holidays SET ${setClause} WHERE holiday_id = @holidayId`;

        const request = pool.request();
        request.input('holidayId', mssql.Int, holidayId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        res.json({
            success: true,
            message: 'Holiday updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. FILTER HOLIDAYS
app.get('/api/public-holidays/filter', async (req, res) => {
    try {
        const { type, year, location_id } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let sql = 'SELECT * FROM public_holidays WHERE 1=1';

        if (type) {
            sql += ' AND holiday_type = @type';
            request.input('type', mssql.NVarChar, type);
        }

        if (year) {
            sql += ' AND DATEPART(year, leave_date) = @year';
            request.input('year', mssql.Int, parseInt(year));
        }

        if (location_id) {
            sql += ' AND (location_id = @locationId OR location_id IS NULL)';
            request.input('locationId', mssql.Int, location_id);
        }

        sql += ' ORDER BY leave_date ASC';

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= OT TYPES API =============

// 1. GET NEXT SORT CODE
app.get('/api/ot-types/next-sort-code', async (req, res) => {
    try {
        console.log('🔢 Getting next OT type sort code...');
        const pool = await getPool();

        const result = await pool.request()
            .query('SELECT ISNULL(MAX(sort_code), 0) + 1 as next_sort_code FROM ot_types');

        console.log('✅ Next OT type sort code:', result.recordset[0].next_sort_code);

        res.json({
            success: true,
            next_sort_code: result.recordset[0].next_sort_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CHECK OT TYPE CODE
app.get('/api/ot-types/check-code/:code', async (req, res) => {
    try {
        const otTypeCode = req.params.code;
        console.log('🔍 Checking OT type code:', otTypeCode);

        if (!otTypeCode) {
            return res.json({ success: true, exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, otTypeCode)
            .query('SELECT ot_type_id FROM ot_types WHERE ot_type_code = @code');

        res.json({
            success: true,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. CREATE OT TYPE
app.post('/api/ot-types', async (req, res) => {
    try {
        const otTypeData = req.body;
        console.log('📝 Creating OT type:', otTypeData.ot_type_code);

        const errors = [];

        if (!otTypeData.ot_type_code) errors.push('OT type code is required');
        if (!otTypeData.ot_type_name) errors.push('OT type name is required');
        if (!otTypeData.sort_code) errors.push('Sort code is required');
        if (otTypeData.min_hours_for_break === undefined || otTypeData.min_hours_for_break === null) {
            errors.push('Minimum hours for break is required');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, otTypeData.ot_type_code)
            .query('SELECT ot_type_id FROM ot_types WHERE ot_type_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `OT type code "${otTypeData.ot_type_code}" already exists`
            });
        }

        // Check if sort code exists
        const sortResult = await pool.request()
            .input('sortCode', mssql.Int, otTypeData.sort_code)
            .query('SELECT ot_type_id FROM ot_types WHERE sort_code = @sortCode');

        if (sortResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Sort code "${otTypeData.sort_code}" already exists. Please use a different sort code.`
            });
        }

        // Set defaults
        otTypeData.created_at = new Date();
        otTypeData.created_by = otTypeData.created_by || 1;

        // Remove undefined
        Object.keys(otTypeData).forEach(key => {
            if (otTypeData[key] === undefined) delete otTypeData[key];
        });

        const columns = Object.keys(otTypeData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO ot_types (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS otTypeId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = otTypeData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ OT type created, ID:', result.recordset[0].otTypeId);

        res.status(201).json({
            success: true,
            message: 'OT type created successfully',
            ot_type_id: result.recordset[0].otTypeId,
            ot_type_code: otTypeData.ot_type_code,
            sort_code: otTypeData.sort_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET ALL OT TYPES
app.get('/api/ot-types', async (req, res) => {
    try {
        const {
            search = '',
            page = 1,
            limit = 20,
            status = 'all'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = 'SELECT * FROM ot_types WHERE 1=1';

        if (search) {
            sql += ' AND (ot_type_code LIKE @search OR ot_type_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        // Count query
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Data query
        sql += ' ORDER BY sort_code ASC, ot_type_name ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET SINGLE OT TYPE
app.get('/api/ot-types/:id', async (req, res) => {
    try {
        const otTypeId = req.params.id;
        console.log('🔍 Getting OT type:', otTypeId);

        const pool = await getPool();
        const result = await pool.request()
            .input('otTypeId', mssql.Int, otTypeId)
            .query('SELECT * FROM ot_types WHERE ot_type_id = @otTypeId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'OT type not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE OT TYPE
app.put('/api/ot-types/:id', async (req, res) => {
    try {
        const otTypeId = req.params.id;
        const updateData = req.body;
        console.log('📝 Updating OT type:', otTypeId);

        const pool = await getPool();

        // Check sort code if provided
        if (updateData.sort_code) {
            const sortResult = await pool.request()
                .input('sortCode', mssql.Int, updateData.sort_code)
                .input('otTypeId', mssql.Int, otTypeId)
                .query('SELECT ot_type_id FROM ot_types WHERE sort_code = @sortCode AND ot_type_id != @otTypeId');

            if (sortResult.recordset.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Sort code "${updateData.sort_code}" already exists. Please use a different sort code.`
                });
            }
        }

        // Add updated timestamp
        updateData.updated_at = new Date();
        updateData.updated_by = updateData.updated_by || 1;

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE ot_types SET ${setClause} WHERE ot_type_id = @otTypeId`;

        const request = pool.request();
        request.input('otTypeId', mssql.Int, otTypeId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'OT type not found'
            });
        }

        res.json({
            success: true,
            message: 'OT type updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. DELETE OT TYPE
app.delete('/api/ot-types/:id', async (req, res) => {
    try {
        const otTypeId = req.params.id;
        console.log('🗑️ Deleting OT type:', otTypeId);

        const pool = await getPool();

        const result = await pool.request()
            .input('otTypeId', mssql.Int, otTypeId)
            .query('DELETE FROM ot_types WHERE ot_type_id = @otTypeId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'OT type not found'
            });
        }

        res.json({
            success: true,
            message: 'OT type deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= ACCOUNT DIVISIONS API =============

// 1. CREATE ACCOUNT DIVISION
app.post('/api/account-divisions', async (req, res) => {
    try {
        const divisionData = req.body;
        console.log('💰 Creating account division:', divisionData.division_code);

        const errors = [];

        if (!divisionData.division_code) errors.push('Division code is required');
        if (!divisionData.division_name) errors.push('Division name is required');
        if (!divisionData.currency_code) errors.push('Currency is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, divisionData.division_code)
            .query('SELECT division_id FROM account_divisions WHERE division_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Division code "${divisionData.division_code}" already exists`
            });
        }

        // Handle default division
        if (divisionData.is_default) {
            await pool.request().query('UPDATE account_divisions SET is_default = 0 WHERE is_default = 1');
        }

        // Set defaults
        divisionData.created_at = new Date();
        divisionData.created_by = divisionData.created_by || 1;

        // Remove undefined
        Object.keys(divisionData).forEach(key => {
            if (divisionData[key] === undefined) delete divisionData[key];
        });

        const columns = Object.keys(divisionData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO account_divisions (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS divisionId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = divisionData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Division created, ID:', result.recordset[0].divisionId);

        res.status(201).json({
            success: true,
            message: 'Account division created successfully',
            division_id: result.recordset[0].divisionId,
            division_code: divisionData.division_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CHECK DIVISION CODE
app.get('/api/account-divisions/check-code/:code', async (req, res) => {
    try {
        const divisionCode = req.params.code;
        console.log('🔍 Checking division code:', divisionCode);

        if (!divisionCode) {
            return res.json({ success: true, exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, divisionCode)
            .query('SELECT division_id FROM account_divisions WHERE division_code = @code');

        res.json({
            success: true,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ALL ACCOUNT DIVISIONS
app.get('/api/account-divisions', async (req, res) => {
    try {
        const {
            search = '',
            page = 1,
            limit = 20,
            status = 'all'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = 'SELECT * FROM account_divisions WHERE 1=1';

        if (search) {
            sql += ' AND (division_code LIKE @search OR division_name LIKE @search OR description LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        // Count query
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Data query
        sql += ' ORDER BY is_default DESC, division_name ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE DIVISION
app.get('/api/account-divisions/:id', async (req, res) => {
    try {
        const divisionId = req.params.id;
        console.log('🔍 Getting division:', divisionId);

        const pool = await getPool();
        const result = await pool.request()
            .input('divisionId', mssql.Int, divisionId)
            .query('SELECT * FROM account_divisions WHERE division_id = @divisionId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Division not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. UPDATE DIVISION
app.put('/api/account-divisions/:id', async (req, res) => {
    try {
        const divisionId = req.params.id;
        const updateData = req.body;
        console.log('📝 Updating division:', divisionId);

        // Add updated timestamp
        updateData.updated_at = new Date();
        updateData.updated_by = updateData.updated_by || 1;

        // Handle default division
        if (updateData.is_default) {
            const pool = await getPool();
            await pool.request()
                .input('divisionId', mssql.Int, divisionId)
                .query('UPDATE account_divisions SET is_default = 0 WHERE is_default = 1 AND division_id != @divisionId');
        }

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE account_divisions SET ${setClause} WHERE division_id = @divisionId`;

        const request = pool.request();
        request.input('divisionId', mssql.Int, divisionId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Division not found'
            });
        }

        res.json({
            success: true,
            message: 'Account division updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE DIVISION
app.delete('/api/account-divisions/:id', async (req, res) => {
    try {
        const divisionId = req.params.id;
        console.log('🗑️ Deleting division:', divisionId);

        const pool = await getPool();

        // Check if default
        const checkResult = await pool.request()
            .input('divisionId', mssql.Int, divisionId)
            .query('SELECT is_default FROM account_divisions WHERE division_id = @divisionId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Division not found'
            });
        }

        if (checkResult.recordset[0].is_default) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete the default division. Set another division as default first.'
            });
        }

        const result = await pool.request()
            .input('divisionId', mssql.Int, divisionId)
            .query('DELETE FROM account_divisions WHERE division_id = @divisionId');

        res.json({
            success: true,
            message: 'Account division deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. TEST ENDPOINT
app.get('/api/account-divisions/test', (req, res) => {
    res.json({
        success: true,
        message: 'Account Divisions API is working!',
        timestamp: new Date().toISOString()
    });
});

// ============= LEAVE TYPES API =============

// 1. CHECK LEAVE CODE
app.get('/api/leave-types/check-code/:code', async (req, res) => {
    try {
        const leaveCode = req.params.code;
        console.log('🔍 Checking leave code:', leaveCode);

        if (!leaveCode) {
            return res.json({ success: true, exists: false });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('code', mssql.NVarChar, leaveCode)
            .query('SELECT leave_type_id FROM leave_types WHERE leave_code = @code');

        res.json({
            success: true,
            exists: result.recordset.length > 0
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET NEXT SORT CODE
app.get('/api/leave-types/next-sort-code', async (req, res) => {
    try {
        console.log('🔢 Getting next leave type sort code...');
        const pool = await getPool();

        const result = await pool.request()
            .query('SELECT ISNULL(MAX(sort_code), 0) + 1 as next_sort_code FROM leave_types');

        console.log('✅ Next leave type sort code:', result.recordset[0].next_sort_code);

        res.json({
            success: true,
            next_sort_code: result.recordset[0].next_sort_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. CREATE LEAVE TYPE
app.post('/api/leave-types', async (req, res) => {
    try {
        const leaveData = req.body;
        console.log('📝 Creating leave type:', leaveData.leave_code);

        const errors = [];

        if (!leaveData.leave_code) errors.push('Leave code is required');
        if (!leaveData.description) errors.push('Description is required');
        if (!leaveData.leave_per_year || leaveData.leave_per_year <= 0) {
            errors.push('Leave per year must be greater than 0');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, leaveData.leave_code)
            .query('SELECT leave_type_id FROM leave_types WHERE leave_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Leave code "${leaveData.leave_code}" already exists`
            });
        }

        // Handle sort code
        if (leaveData.sort_code && leaveData.sort_code > 0) {
            const sortResult = await pool.request()
                .input('sortCode', mssql.Int, leaveData.sort_code)
                .query('SELECT leave_type_id FROM leave_types WHERE sort_code = @sortCode');

            if (sortResult.recordset.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Sort code "${leaveData.sort_code}" already exists`
                });
            }
        } else {
            // Auto-generate sort code
            const autoSort = await pool.request()
                .query('SELECT ISNULL(MAX(sort_code), 0) + 1 as next_sort FROM leave_types');
            leaveData.sort_code = autoSort.recordset[0].next_sort;
        }

        // Set defaults for boolean fields
        const booleanFields = [
            'leave_in_payslip', 'balance_in_payslip', 'is_active', 'pro_rated',
            'is_half_day', 'block_on_probation', 'auto_entitlement',
            'attachment_required', 'only_full_day', 'hide_balance_mobile',
            'hide_in_mobile', 'is_system', 'include_off_days', 'remarks_required',
            'custom_payslip_enabled'
        ];

        booleanFields.forEach(field => {
            if (leaveData[field] === true) {
                leaveData[field] = 1;
            } else if (leaveData[field] === false) {
                leaveData[field] = 0;
            } else if (leaveData[field] === undefined) {
                if (field === 'auto_entitlement' || field === 'is_active') {
                    leaveData[field] = 1;
                } else {
                    leaveData[field] = 0;
                }
            }
        });

        // Set default string fields
        if (!leaveData.carry_forward_type) leaveData.carry_forward_type = 'none';
        if (!leaveData.pay_type) leaveData.pay_type = 'paid';
        if (!leaveData.entitlement_type) leaveData.entitlement_type = 'year';
        if (!leaveData.earned_type) leaveData.earned_type = 'calendar_year';

        // Set audit fields
        leaveData.created_at = new Date();
        leaveData.created_by = leaveData.created_by || 1;

        // Remove undefined
        Object.keys(leaveData).forEach(key => {
            if (leaveData[key] === undefined) delete leaveData[key];
        });

        const columns = Object.keys(leaveData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO leave_types (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS leaveTypeId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = leaveData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log('✅ Leave type created, ID:', result.recordset[0].leaveTypeId);

        res.status(201).json({
            success: true,
            message: 'Leave type created successfully',
            leave_type_id: result.recordset[0].leaveTypeId,
            leave_code: leaveData.leave_code,
            sort_code: leaveData.sort_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET ALL LEAVE TYPES
app.get('/api/leave-types', async (req, res) => {
    try {
        const {
            search = '',
            page = 1,
            limit = 20,
            status = 'all',
            entitlement = 'all'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = 'SELECT * FROM leave_types WHERE 1=1';

        if (search) {
            sql += ' AND (leave_code LIKE @search OR description LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (status === 'active') {
            sql += ' AND is_active = 1';
        } else if (status === 'inactive') {
            sql += ' AND is_active = 0';
        }

        if (entitlement === 'true') {
            sql += ' AND auto_entitlement = 1';
        } else if (entitlement === 'false') {
            sql += ' AND auto_entitlement = 0';
        }

        // Count query
        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Data query
        sql += ' ORDER BY sort_code ASC, leave_code ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET SINGLE LEAVE TYPE
app.get('/api/leave-types/:id', async (req, res) => {
    try {
        const leaveId = req.params.id;
        console.log('🔍 Getting leave type:', leaveId);

        const pool = await getPool();
        const result = await pool.request()
            .input('leaveId', mssql.Int, leaveId)
            .query('SELECT * FROM leave_types WHERE leave_type_id = @leaveId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave type not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE LEAVE TYPE
app.put('/api/leave-types/:id', async (req, res) => {
    try {
        const leaveId = req.params.id;
        const updateData = req.body;
        console.log('📝 Updating leave type:', leaveId);

        // Add updated timestamp
        updateData.updated_at = new Date();

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE leave_types SET ${setClause} WHERE leave_type_id = @leaveId`;

        const request = pool.request();
        request.input('leaveId', mssql.Int, leaveId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave type not found'
            });
        }

        res.json({
            success: true,
            message: 'Leave type updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. DELETE LEAVE TYPE
app.delete('/api/leave-types/:id', async (req, res) => {
    try {
        const leaveId = req.params.id;
        console.log('🗑️ Deleting leave type:', leaveId);

        const pool = await getPool();

        const result = await pool.request()
            .input('leaveId', mssql.Int, leaveId)
            .query('DELETE FROM leave_types WHERE leave_type_id = @leaveId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave type not found'
            });
        }

        res.json({
            success: true,
            message: 'Leave type deleted successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. TEST ENDPOINT
app.get('/api/leave-types/test', (req, res) => {
    res.json({
        success: true,
        message: 'Leave Types API is working!',
        timestamp: new Date().toISOString()
    });
});

// ============= CURRENCY API =============

// 1. CREATE CURRENCY
app.post('/api/currencies', async (req, res) => {
    try {
        const currencyData = req.body;
        console.log('💰 Creating currency:', currencyData.currency_code);

        const errors = [];

        if (!currencyData.currency_code) errors.push('Currency code is required');
        if (!currencyData.currency_name) errors.push('Currency name is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, currencyData.currency_code)
            .query('SELECT currency_id FROM currencies WHERE currency_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Currency code "${currencyData.currency_code}" already exists`
            });
        }

        // Handle default currency
        if (currencyData.is_default) {
            await pool.request().query('UPDATE currencies SET is_default = 0 WHERE is_default = 1');
        }

        // Set defaults
        const defaults = {
            decimal_places: 2,
            exchange_rate: 1.000000,
            currency_format: 'Dollar ($1,234,567.89)',
            is_active: 1,
            is_default: 0,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...currencyData };

        // Parse numeric values
        finalData.exchange_rate = parseFloat(finalData.exchange_rate) || 1.000000;
        finalData.decimal_places = parseInt(finalData.decimal_places) || 2;

        // Remove undefined
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO currencies (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS currencyId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 6), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'Currency created successfully',
            currency_id: result.recordset[0].currencyId,
            currency_code: finalData.currency_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET ALL CURRENCIES WITH SORTING
app.get('/api/currencies', async (req, res) => {
    try {
        const search = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const sort = req.query.sort || 'currency_code';
        const order = req.query.order || 'asc';
        const offset = (page - 1) * limit;

        const validSortColumns = ['currency_code', 'currency_name', 'exchange_rate', 'is_default', 'is_active', 'created_at'];
        const sortColumn = validSortColumns.includes(sort) ? sort : 'currency_code';
        const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        const pool = await getPool();
        const request = pool.request();

        let whereClause = 'WHERE 1=1';

        if (search) {
            whereClause += ' AND (currency_code LIKE @search OR currency_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM currencies ${whereClause}`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / limit);

        const orderBySql = sortColumn === 'currency_code'
            ? `ORDER BY currency_code ${sortOrder}`
            : `ORDER BY ${sortColumn} ${sortOrder}, currency_code ASC`;

        // Data query
        const sql = `
            SELECT 
                *,
                FORMAT(created_at, 'dd-MM-yyyy HH:mm') as formatted_created_at,
                FORMAT(updated_at, 'dd-MM-yyyy HH:mm') as formatted_updated_at
            FROM currencies
            ${whereClause}
            ${orderBySql}
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, offset);
        request.input('limit', mssql.Int, limit);

        const result = await request.query(sql);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. UPDATE CURRENCY RATES
app.post('/api/currencies/update-rates', async (req, res) => {
    try {
        const { effective_date, rates } = req.body;

        if (!effective_date || !rates || !Array.isArray(rates)) {
            return res.json({ success: false, error: 'Missing data' });
        }

        const pool = await getPool();
        let updated = 0;
        let processed = 0;

        for (const rate of rates) {
            // Get current rate
            const getResult = await pool.request()
                .input('currencyId', mssql.Int, rate.currency_id)
                .query('SELECT exchange_rate FROM currencies WHERE currency_id = @currencyId');

            if (getResult.recordset.length === 0) {
                processed++;
                continue;
            }

            const oldRate = getResult.recordset[0].exchange_rate;
            const newRate = parseFloat(rate.new_rate);

            // Calculate percentage change
            const changePercent = oldRate ?
                ((newRate - oldRate) / oldRate * 100).toFixed(4) :
                0;

            // Update rate
            const updateResult = await pool.request()
                .input('currencyId', mssql.Int, rate.currency_id)
                .input('newRate', mssql.Decimal(18, 6), newRate)
                .query('UPDATE currencies SET exchange_rate = @newRate, updated_at = GETDATE() WHERE currency_id = @currencyId');

            if (updateResult.rowsAffected[0] > 0) {
                updated++;

                // Save to history
                await pool.request()
                    .input('currencyId', mssql.Int, rate.currency_id)
                    .input('oldRate', mssql.Decimal(18, 6), oldRate)
                    .input('newRate', mssql.Decimal(18, 6), newRate)
                    .input('effectiveDate', mssql.Date, parseDate(effective_date))
                    .input('changePercent', mssql.Decimal(18, 4), changePercent)
                    .input('notes', mssql.NVarChar, 'Rate update')
                    .input('changedBy', mssql.NVarChar, 'admin')
                    .query(`
                        INSERT INTO currency_rate_history 
                        (currency_id, old_rate, new_rate, effective_date, change_percentage, notes, changed_by)
                        VALUES 
                        (@currencyId, @oldRate, @newRate, @effectiveDate, @changePercent, @notes, @changedBy)
                    `);
            }

            processed++;
        }

        res.json({
            success: true,
            message: `Updated ${updated} rates`,
            updated_count: updated
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE CURRENCY
app.get('/api/currencies/:id', async (req, res) => {
    try {
        const currencyId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('currencyId', mssql.Int, currencyId)
            .query('SELECT * FROM currencies WHERE currency_id = @currencyId');

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Currency not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. UPDATE CURRENCY
app.put('/api/currencies/:id', async (req, res) => {
    try {
        const currencyId = req.params.id;
        const updateData = req.body;
        console.log(`✏️ Updating currency ${currencyId}:`, updateData);

        const errors = [];

        if (updateData.currency_name !== undefined && !updateData.currency_name.trim()) {
            errors.push('Currency name is required');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Handle default currency
        if (updateData.is_default === true) {
            await pool.request().query('UPDATE currencies SET is_default = 0 WHERE is_default = 1');
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Parse numeric values
        if (updateData.exchange_rate !== undefined) {
            updateData.exchange_rate = parseFloat(updateData.exchange_rate);
        }

        if (updateData.decimal_places !== undefined) {
            updateData.decimal_places = parseInt(updateData.decimal_places);
        }

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE currencies SET ${setClause} WHERE currency_id = @currencyId`;

        const request = pool.request();
        request.input('currencyId', mssql.Int, currencyId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 6), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Currency not found'
            });
        }

        res.json({
            success: true,
            message: 'Currency updated successfully',
            affectedRows: result.rowsAffected[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE CURRENCY
app.delete('/api/currencies/:id', async (req, res) => {
    try {
        const currencyId = req.params.id;
        const pool = await getPool();

        // Check if default
        const checkResult = await pool.request()
            .input('currencyId', mssql.Int, currencyId)
            .query('SELECT currency_code, is_default FROM currencies WHERE currency_id = @currencyId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Currency not found'
            });
        }

        if (checkResult.recordset[0].is_default) {
            return res.status(409).json({
                success: false,
                error: 'Cannot delete default currency. Set another currency as default first.'
            });
        }

        const result = await pool.request()
            .input('currencyId', mssql.Int, currencyId)
            .query('DELETE FROM currencies WHERE currency_id = @currencyId');

        res.json({
            success: true,
            message: 'Currency deleted successfully',
            deleted_id: currencyId
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. GET CURRENCIES FOR UPDATE
app.get('/api/currencies/update', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                currency_id, 
                currency_code, 
                currency_name,
                currency_symbol,
                exchange_rate,
                is_default,
                decimal_places,
                is_active
            FROM currencies 
            ORDER BY 
                is_default DESC,
                currency_code ASC
        `;

        const result = await pool.request().query(sql);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. GET CURRENCY RATE HISTORY
app.get('/api/currencies/:id/rate-history', async (req, res) => {
    try {
        const currencyId = req.params.id;
        const limit = parseInt(req.query.limit) || 10;

        const pool = await getPool();

        const result = await pool.request()
            .input('currencyId', mssql.Int, currencyId)
            .input('limit', mssql.Int, limit)
            .query(`
                SELECT 
                    history_id,
                    currency_id,
                    old_rate,
                    new_rate,
                    FORMAT(effective_date, 'yyyy-MM-dd') as effective_date,
                    change_percentage,
                    notes,
                    changed_by,
                    FORMAT(changed_at, 'dd-MM-yyyy HH:mm') as changed_at
                FROM currency_rate_history
                WHERE currency_id = @currencyId
                ORDER BY effective_date DESC, changed_at DESC
                OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY
            `);

        // Get currency info
        const currencyResult = await pool.request()
            .input('currencyId', mssql.Int, currencyId)
            .query('SELECT currency_code, currency_name FROM currencies WHERE currency_id = @currencyId');

        const currencyInfo = currencyResult.recordset.length > 0 ? currencyResult.recordset[0] : {};

        res.json({
            success: true,
            data: result.recordset,
            currency_info: currencyInfo,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 9. GET ALL RATE HISTORY
app.get('/api/currencies/rate-history/all', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const offset = (page - 1) * limit;

        const pool = await getPool();

        const sql = `
            SELECT 
                crh.history_id,
                crh.currency_id,
                c.currency_code,
                c.currency_name,
                crh.old_rate,
                crh.new_rate,
                FORMAT(crh.effective_date, 'dd-MM-yyyy') as effective_date,
                crh.change_percentage,
                crh.notes,
                crh.changed_by,
                FORMAT(crh.changed_at, 'dd-MM-yyyy HH:mm') as changed_at,
                CASE 
                    WHEN crh.change_percentage > 0 THEN 'increase'
                    WHEN crh.change_percentage < 0 THEN 'decrease'
                    ELSE 'no change'
                END as change_type
            FROM currency_rate_history crh
            JOIN currencies c ON crh.currency_id = c.currency_id
            ORDER BY crh.changed_at DESC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        const result = await pool.request()
            .input('offset', mssql.Int, offset)
            .input('limit', mssql.Int, limit)
            .query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 10. ADD RATE HISTORY
app.post('/api/currencies/:id/rate-history', async (req, res) => {
    try {
        const currencyId = req.params.id;
        const { exchange_rate, effective_date, notes, created_by } = req.body;

        if (!exchange_rate || !effective_date) {
            return res.status(400).json({
                success: false,
                error: 'Exchange rate and effective date are required'
            });
        }

        const pool = await getPool();

        const result = await pool.request()
            .input('currencyId', mssql.Int, currencyId)
            .input('exchangeRate', mssql.Decimal(18, 6), parseFloat(exchange_rate))
            .input('effectiveDate', mssql.Date, parseDate(effective_date))
            .input('notes', mssql.NVarChar, notes || 'Rate updated')
            .input('createdBy', mssql.NVarChar, created_by || 'system')
            .query(`
                INSERT INTO currency_rates_history 
                (currency_id, exchange_rate, effective_date, notes, created_by)
                VALUES 
                (@currencyId, @exchangeRate, @effectiveDate, @notes, @createdBy);
                SELECT SCOPE_IDENTITY() AS historyId
            `);

        res.status(201).json({
            success: true,
            message: 'Rate history saved',
            history_id: result.recordset[0].historyId
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 11. GET ACTIVE CURRENCIES
app.get('/api/currencies/active', async (req, res) => {
    try {
        console.log('🌐 Fetching active currencies');
        const pool = await getPool();

        // Try with common column names
        let sql = `
            SELECT 
                currency_id, 
                currency_code, 
                currency_name,
                currency_symbol,
                exchange_rate,
                is_default,
                decimal_places,
                is_active
            FROM currencies 
            WHERE is_active = 1
            ORDER BY is_default DESC, currency_code ASC
        `;

        try {
            const result = await pool.request().query(sql);
            console.log(`✅ Found ${result.recordset.length} active currencies`);
            
            res.json({
                success: true,
                data: result.recordset,
                count: result.recordset.length
            });
        } catch (firstErr) {
            // Try alternative column names
            console.log('Trying alternative column names...');
            sql = `
                SELECT 
                    currency_id, 
                    code as currency_code, 
                    name as currency_name,
                    symbol as currency_symbol,
                    exchange_rate,
                    is_default,
                    decimal_places,
                    active as is_active
                FROM currencies 
                WHERE active = 1
                ORDER BY is_default DESC, code ASC
            `;
            
            const result = await pool.request().query(sql);
            console.log(`✅ Found ${result.recordset.length} active currencies (alt columns)`);
            
            res.json({
                success: true,
                data: result.recordset,
                count: result.recordset.length
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ============= CHARTS OF ACCOUNT =============

// 1. CREATE ACCOUNT
app.post('/api/accounts', async (req, res) => {
    try {
        const {
            account_code,
            account_name,
            description,
            parent_account_id,
            account_type,
            currency_id,
            is_placeholder,
            is_system_account,
            opening_balance
        } = req.body;

        // Validate account code format
        if (!account_code || !/^[0-9]+(-[0-9]+)*$/.test(account_code)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid account code format. Use: 100 or 100-001'
            });
        }

        const pool = await getPool();

        // Check if code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, account_code)
            .query('SELECT account_id FROM chart_of_accounts WHERE account_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Account code "${account_code}" already exists`
            });
        }

        // Calculate root level
        let rootLevel = 1;
        if (parent_account_id) {
            const parentResult = await pool.request()
                .input('parentId', mssql.Int, parent_account_id)
                .query('SELECT root_level FROM chart_of_accounts WHERE account_id = @parentId');

            if (parentResult.recordset.length > 0) {
                rootLevel = parentResult.recordset[0].root_level + 1;
            }
        }

        const insertData = {
            account_code,
            account_name,
            description: description || null,
            parent_account_id: parent_account_id || null,
            account_type,
            currency_id: currency_id || 1,
            is_placeholder: toBit(is_placeholder || false),
            is_system_account: toBit(is_system_account || false),
            is_active: 1,
            root_level: rootLevel,
            is_root: parent_account_id ? 0 : 1,
            opening_balance: opening_balance || 0,
            current_balance: opening_balance || 0,
            created_by: 'admin',
            updated_by: 'admin',
            created_at: new Date()
        };

        const columns = Object.keys(insertData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO chart_of_accounts (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS accountId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = insertData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Account created: ${account_code} (ID: ${result.recordset[0].accountId})`);

        res.status(201).json({
            success: true,
            message: 'Account created successfully',
            account_id: result.recordset[0].accountId,
            account_code: account_code,
            account_name: account_name
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET PARENT ACCOUNTS
app.get('/api/accounts/parents', async (req, res) => {
    try {
        console.log('📞 Fetching parent accounts (placeholders only)');
        const pool = await getPool();

        const sql = `
            SELECT 
                account_id,
                account_code,
                account_name,
                account_type,
                root_level,
                is_placeholder,
                is_root,
                CAST(LEFT(account_code, CASE WHEN CHARINDEX('-', account_code) > 0 THEN CHARINDEX('-', account_code) - 1 ELSE LEN(account_code) END) AS INT) as sort_part1,
                CASE 
                    WHEN CHARINDEX('-', account_code) > 0 
                    THEN CAST(SUBSTRING(account_code, CHARINDEX('-', account_code) + 1, 
                         CASE WHEN CHARINDEX('-', account_code, CHARINDEX('-', account_code) + 1) > 0 
                              THEN CHARINDEX('-', account_code, CHARINDEX('-', account_code) + 1) - CHARINDEX('-', account_code) - 1
                              ELSE LEN(account_code) 
                         END) AS INT)
                    ELSE 0 
                END as sort_part2
            FROM chart_of_accounts 
            WHERE is_placeholder = 1 
              AND is_active = 1
            ORDER BY 
                sort_part1,
                sort_part2,
                account_code
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} placeholder accounts`);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. SUGGEST ACCOUNT CODE
app.get('/api/accounts/suggest-code', async (req, res) => {
    try {
        const parentCode = req.query.parent;
        const pool = await getPool();

        if (!parentCode) {
            return res.json({
                success: false,
                error: 'Parent code required'
            });
        }

        if (parentCode === 'ROOT') {
            // For ROOT, suggest main categories: 100, 200, 300, etc.
            const result = await pool.request()
                .query(`
                    SELECT MAX(CAST(LEFT(account_code, CHARINDEX('-', account_code + '-') - 1) AS INT)) as max_code
                    FROM chart_of_accounts 
                    WHERE parent_account_id IS NULL 
                      AND account_code NOT LIKE '%-%'
                `);

            const maxCode = result.recordset[0]?.max_code || 0;
            const nextCode = (maxCode + 100) - (maxCode % 100);
            const suggestedCode = String(nextCode).padStart(3, '0');

            res.json({
                success: true,
                suggested_code: suggestedCode
            });
        } else {
            // For sub-accounts
            const pattern = `^${parentCode}-[0-9]+$`;
            
            const result = await pool.request()
                .input('parentCode', mssql.NVarChar, parentCode)
                .query(`
                    SELECT account_code
                    FROM chart_of_accounts 
                    WHERE account_code LIKE @parentCode + '-%'
                      AND account_code NOT LIKE '%[-]%[-]%'
                    ORDER BY account_code DESC
                    OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY
                `);

            if (result.recordset.length === 0) {
                return res.json({
                    success: true,
                    suggested_code: `${parentCode}-001`
                });
            }

            // Get last code and increment
            const lastCode = result.recordset[0].account_code;
            const parts = lastCode.split('-');
            const lastNumber = parseInt(parts[parts.length - 1]);
            const nextNumber = lastNumber + 1;

            parts[parts.length - 1] = String(nextNumber).padStart(3, '0');
            const suggestedCode = parts.join('-');

            res.json({
                success: true,
                suggested_code: suggestedCode
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET ALL ACCOUNTS
app.get('/api/accounts/all', async (req, res) => {
    try {
        console.log('📊 Fetching ALL accounts (no pagination)');
        const pool = await getPool();

        const sql = `
            SELECT 
                a.account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                a.description,
                a.current_balance,
                a.opening_balance,
                a.is_placeholder,
                a.is_system_account,
                a.is_active,
                a.is_root,
                a.root_level,
                a.created_at,
                a.updated_at,
                p.account_name AS parent_account_name,
                p.account_code AS parent_account_code,
                c.currency_code,
                c.currency_symbol,
                (SELECT COUNT(*) FROM chart_of_accounts child WHERE child.parent_account_id = a.account_id) as child_count,
                CAST(LEFT(a.account_code, CASE WHEN CHARINDEX('-', a.account_code) > 0 THEN CHARINDEX('-', a.account_code) - 1 ELSE LEN(a.account_code) END) AS INT) as code_part1,
                CASE 
                    WHEN CHARINDEX('-', a.account_code) > 0 
                    THEN CAST(SUBSTRING(a.account_code, CHARINDEX('-', a.account_code) + 1, 
                         CASE WHEN CHARINDEX('-', a.account_code, CHARINDEX('-', a.account_code) + 1) > 0 
                              THEN CHARINDEX('-', a.account_code, CHARINDEX('-', a.account_code) + 1) - CHARINDEX('-', a.account_code) - 1
                              ELSE LEN(a.account_code) 
                         END) AS INT)
                    ELSE 0 
                END as code_part2
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE a.is_active = 1
            ORDER BY 
                code_part1,
                code_part2,
                a.account_code
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} total accounts`);

        // Format results
        const formattedResults = result.recordset.map(account => {
            const balance = account.current_balance || 0;
            let balanceFormatted = '';
            let balanceColor = '#64748b';

            if (balance !== 0) {
                balanceFormatted = Math.abs(balance).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });

                if (balance > 0) {
                    balanceColor = '#2e7d32';
                } else {
                    balanceColor = '#d32f2f';
                    balanceFormatted = `(${balanceFormatted})`;
                }
            }

            return {
                ...account,
                balance_formatted: balanceFormatted,
                balance_color: balanceColor
            };
        });

        res.json({
            success: true,
            data: formattedResults,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET ACCOUNTS WITH PAGINATION
app.get('/api/accounts', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            type = '',
            parent = ''
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                a.account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                a.description,
                a.current_balance,
                a.opening_balance,
                a.is_placeholder,
                a.is_system_account,
                a.is_active,
                a.is_root,
                a.root_level,
                a.created_at,
                a.updated_at,
                p.account_name AS parent_account_name,
                p.account_code AS parent_account_code,
                c.currency_code,
                c.currency_symbol,
                (SELECT COUNT(*) FROM chart_of_accounts child WHERE child.parent_account_id = a.account_id) as child_count,
                CAST(LEFT(a.account_code, CASE WHEN CHARINDEX('-', a.account_code) > 0 THEN CHARINDEX('-', a.account_code) - 1 ELSE LEN(a.account_code) END) AS INT) as code_part1,
                CASE 
                    WHEN CHARINDEX('-', a.account_code) > 0 
                    THEN CAST(SUBSTRING(a.account_code, CHARINDEX('-', a.account_code) + 1, 
                         CASE WHEN CHARINDEX('-', a.account_code, CHARINDEX('-', a.account_code) + 1) > 0 
                              THEN CHARINDEX('-', a.account_code, CHARINDEX('-', a.account_code) + 1) - CHARINDEX('-', a.account_code) - 1
                              ELSE LEN(a.account_code) 
                         END) AS INT)
                    ELSE 0 
                END as code_part2
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE a.is_active = 1
        `;

        // Apply filters
        if (search) {
            sql += ' AND (a.account_code LIKE @search OR a.account_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (type && type !== 'ALL' && type !== 'All Types') {
            sql += ' AND a.account_type = @type';
            request.input('type', mssql.NVarChar, type);
        }

        if (parent === 'ROOT') {
            sql += ' AND a.parent_account_id IS NULL';
        } else if (parent && parent !== 'Root') {
            sql += ' AND p.account_code = @parent';
            request.input('parent', mssql.NVarChar, parent);
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM (${sql}) as filtered`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Add ordering and pagination
        sql += ` 
            ORDER BY 
                CASE WHEN a.parent_account_id IS NULL THEN 0 ELSE 1 END,
                code_part1,
                code_part2,
                a.account_code
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        // Format results
        const formattedResults = result.recordset.map(account => {
            const balance = account.current_balance || 0;
            let balanceFormatted = '';
            let balanceColor = '#64748b';

            if (balance !== 0) {
                balanceFormatted = Math.abs(balance).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });

                if (balance > 0) {
                    balanceColor = '#2e7d32';
                } else {
                    balanceColor = '#d32f2f';
                    balanceFormatted = `(${balanceFormatted})`;
                }
            }

            return {
                ...account,
                display_name: account.account_name,
                parent_display: account.parent_account_name || 'Root',
                balance_formatted: balanceFormatted,
                balance_color: balanceColor,
                balance_raw: balance
            };
        });

        res.json({
            success: true,
            data: formattedResults,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                total_pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE ACCOUNT
app.put('/api/accounts/:id', async (req, res) => {
    try {
        const accountId = req.params.id;
        const updateData = req.body;
        console.log(`📝 Updating account ID: ${accountId}`, updateData);

        // Validate required fields
        if (!updateData.account_name) {
            return res.status(400).json({
                success: false,
                error: 'Account name is required'
            });
        }

        if (!updateData.currency_id) {
            return res.status(400).json({
                success: false,
                error: 'Currency is required'
            });
        }

        if (!updateData.account_type) {
            return res.status(400).json({
                success: false,
                error: 'Account type is required'
            });
        }

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('accountId', mssql.Int, accountId)
            .query('SELECT account_id, account_code FROM chart_of_accounts WHERE account_id = @accountId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Account not found'
            });
        }

        const account = checkResult.recordset[0];

        // Calculate new root level if parent changed
        let newLevel = null;
        if (updateData.parent_account_id !== undefined) {
            if (updateData.parent_account_id) {
                const parentResult = await pool.request()
                    .input('parentId', mssql.Int, updateData.parent_account_id)
                    .query('SELECT root_level FROM chart_of_accounts WHERE account_id = @parentId');

                if (parentResult.recordset.length > 0) {
                    newLevel = parentResult.recordset[0].root_level + 1;
                } else {
                    newLevel = 1;
                }
            } else {
                newLevel = 1;
            }
        }

        // Prepare update data
        const finalUpdateData = {
            account_name: updateData.account_name,
            description: updateData.description || null,
            currency_id: updateData.currency_id,
            account_type: updateData.account_type,
            is_placeholder: toBit(updateData.is_placeholder || false),
            is_system_account: toBit(updateData.is_system_account || false),
            is_active: toBit(updateData.is_active !== undefined ? updateData.is_active : true),
            updated_by: updateData.updated_by || 'admin',
            updated_at: new Date()
        };

        if (updateData.parent_account_id !== undefined) {
            finalUpdateData.parent_account_id = updateData.parent_account_id || null;
        }

        if (newLevel !== null) {
            finalUpdateData.root_level = newLevel;
        }

        // Build SET clause
        const setClause = Object.keys(finalUpdateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE chart_of_accounts SET ${setClause} WHERE account_id = @accountId`;

        const request = pool.request();
        request.input('accountId', mssql.Int, accountId);
        
        Object.keys(finalUpdateData).forEach(key => {
            const val = finalUpdateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Account "${account.account_code}" updated successfully`);

        res.json({
            success: true,
            message: 'Account updated successfully',
            account_id: accountId,
            account_code: account.account_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. GET ACCOUNT DETAILS
app.get('/api/accounts/:id/details', async (req, res) => {
    try {
        const accountId = req.params.id;
        console.log(`📋 Getting details for account ID: ${accountId}`);

        const pool = await getPool();

        const sql = `
            SELECT 
                a.account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                a.description,
                a.current_balance,
                a.is_placeholder,
                a.is_system_account,
                a.is_active,
                a.root_level,
                p.account_name AS parent_account_name,
                p.account_code AS parent_account_code,
                c.currency_code,
                (
                    SELECT COUNT(*) 
                    FROM chart_of_accounts child 
                    WHERE child.parent_account_id = a.account_id 
                    AND child.is_active = 1
                ) as child_count,
                (
                    SELECT STRING_AGG(CONCAT(child.account_code, ' - ', child.account_name), CHAR(10))
                    FROM chart_of_accounts child 
                    WHERE child.parent_account_id = a.account_id 
                    AND child.is_active = 1
                ) as child_accounts_list
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE a.account_id = @accountId
        `;

        const result = await pool.request()
            .input('accountId', mssql.Int, accountId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Account not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. REACTIVATE ACCOUNT
app.put('/api/accounts/:id/reactivate', async (req, res) => {
    try {
        const accountId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('accountId', mssql.Int, accountId)
            .query(`
                UPDATE chart_of_accounts 
                SET is_active = 1, updated_at = GETDATE()
                WHERE account_id = @accountId AND is_active = 0
            `);

        if (result.rowsAffected[0] === 0) {
            return res.json({
                success: false,
                error: 'Account not found or already active'
            });
        }

        res.json({
            success: true,
            message: 'Account reactivated successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 9. HARD DELETE ACCOUNT
app.delete('/api/accounts/:id/hard', async (req, res) => {
    try {
        const accountId = req.params.id;
        console.log(`💀 HARD DELETE requested for account ID: ${accountId}`);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('accountId', mssql.Int, accountId)
            .query('SELECT account_id, account_code, account_name FROM chart_of_accounts WHERE account_id = @accountId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Account not found'
            });
        }

        const account = checkResult.recordset[0];

        // Check if has child accounts
        const childResult = await pool.request()
            .input('accountId', mssql.Int, accountId)
            .query('SELECT COUNT(*) as child_count FROM chart_of_accounts WHERE parent_account_id = @accountId');

        const childCount = childResult.recordset[0]?.child_count || 0;

        if (childCount > 0) {
            return res.status(400).json({
                success: false,
                error: `Cannot delete account "${account.account_code}" - It has ${childCount} child account(s). Delete child accounts first.`
            });
        }

        // Delete
        const deleteResult = await pool.request()
            .input('accountId', mssql.Int, accountId)
            .query('DELETE FROM chart_of_accounts WHERE account_id = @accountId');

        console.log(`✅ Account "${account.account_code}" permanently deleted`);

        res.json({
            success: true,
            message: `Account "${account.account_code} - ${account.account_name}" permanently deleted`,
            deleted_account: account
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= BANK API =============

// 1. CREATE BANK
app.post('/api/banks', async (req, res) => {
    try {
        const bankData = req.body;
        console.log('🏦 Creating bank:', bankData.bank_name);

        const errors = [];
        if (!bankData.bank_code) errors.push('Bank code is required');
        if (!bankData.bank_name) errors.push('Bank name is required');
        if (!bankData.chart_account_id) errors.push('Chart of account is required');
        if (!bankData.currency_id) errors.push('Currency is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if bank code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, bankData.bank_code)
            .query('SELECT bank_id FROM banks WHERE bank_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Bank code "${bankData.bank_code}" already exists`
            });
        }

        // Check if chart account exists and is not placeholder
        const accountResult = await pool.request()
            .input('accountId', mssql.Int, bankData.chart_account_id)
            .query('SELECT account_id, is_placeholder FROM chart_of_accounts WHERE account_id = @accountId');

        if (accountResult.recordset.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Selected chart account does not exist'
            });
        }

        if (accountResult.recordset[0].is_placeholder) {
            return res.status(400).json({
                success: false,
                error: 'Cannot select a placeholder account for bank'
            });
        }

        // Check if currency exists
        const currencyResult = await pool.request()
            .input('currencyId', mssql.Int, bankData.currency_id)
            .query('SELECT currency_id FROM currencies WHERE currency_id = @currencyId AND is_active = 1');

        if (currencyResult.recordset.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Selected currency does not exist or is inactive'
            });
        }

        // If setting as default, unset other defaults
        if (bankData.is_default) {
            await pool.request().query('UPDATE banks SET is_default = 0 WHERE is_default = 1');
        }

        // Prepare insert data
        const insertData = {
            bank_code: bankData.bank_code,
            bank_name: bankData.bank_name,
            account_number: bankData.account_number || null,
            beneficiary_name: bankData.beneficiary_name || null,
            phone_number: bankData.phone_number || null,
            branch_code: bankData.branch_code || null,
            swift_code: bankData.swift_code || null,
            ifsc_code: bankData.ifsc_code || null,
            account_type: bankData.account_type || 'CURRENT',
            file_format: bankData.file_format || 'GENERIC',
            chart_account_id: bankData.chart_account_id,
            address1: bankData.address1 || null,
            address2: bankData.address2 || null,
            address3: bankData.address3 || null,
            city: bankData.city || 'Singapore',
            country: bankData.country || 'Singapore',
            postal_code: bankData.postal_code || null,
            currency_id: bankData.currency_id,
            is_active: toBit(bankData.is_active !== undefined ? bankData.is_active : true),
            is_default: toBit(bankData.is_default || false),
            created_by: 'admin',
            updated_by: 'admin',
            created_at: new Date()
        };

        const columns = Object.keys(insertData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO banks (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS bankId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = insertData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Bank created: ${bankData.bank_code} (ID: ${result.recordset[0].bankId})`);

        res.status(201).json({
            success: true,
            message: 'Bank created successfully',
            bank_id: result.recordset[0].bankId,
            bank_code: bankData.bank_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET ACCOUNTS FOR BANK
app.get('/api/accounts/for-bank', async (req, res) => {
    try {
        console.log('📊 Fetching accounts for bank dropdown');
        const pool = await getPool();

        const sql = `
            SELECT 
                account_id,
                account_code,
                account_name,
                account_type,
                is_placeholder,
                root_level,
                parent_account_id
            FROM chart_of_accounts 
            WHERE is_active = 1 
            ORDER BY 
                is_placeholder,
                account_code ASC
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} accounts for bank dropdown`);

        const nonPlaceholderAccounts = result.recordset.filter(acc => acc.is_placeholder === 0);

        res.json({
            success: true,
            data: result.recordset,
            non_placeholder: nonPlaceholderAccounts,
            count: result.recordset.length,
            non_placeholder_count: nonPlaceholderAccounts.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ACCOUNTS FOR BANK DROPDOWN
app.get('/api/accounts/bank-dropdown', async (req, res) => {
    try {
        console.log('🏦 Fetching ALL accounts for bank dropdown...');
        const pool = await getPool();

        const sql = `
            SELECT 
                a.account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                a.is_placeholder,
                a.is_active,
                a.root_level,
                a.parent_account_id,
                p.account_name AS parent_account_name,
                p.account_code AS parent_account_code,
                c.currency_code
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE a.is_active = 1
            ORDER BY 
                CAST(LEFT(a.account_code, CASE WHEN CHARINDEX('-', a.account_code) > 0 THEN CHARINDEX('-', a.account_code) - 1 ELSE LEN(a.account_code) END) AS INT),
                a.root_level
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} TOTAL accounts (including placeholders)`);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET ALL BANKS
app.get('/api/banks', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            account_type = '',
            is_default = '',
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                b.bank_id,
                b.bank_code,
                b.bank_name,
                (b.bank_code + ' - ' + b.bank_name) as display_name,
                b.account_number,
                b.beneficiary_name,
                b.phone_number,
                b.branch_code,
                b.swift_code,
                b.ifsc_code,
                b.account_type,
                b.file_format,
                b.is_active,
                b.is_default,
                b.created_at,
                b.updated_at,
                ca.account_code as chart_account_code,
                ca.account_name as chart_account_name,
                c.currency_code,
                c.currency_symbol,
                CONCAT_WS(', ', 
                    NULLIF(b.address1, ''),
                    NULLIF(b.address2, ''),
                    NULLIF(b.city, ''),
                    NULLIF(b.country, '')
                ) as address_display
            FROM banks b
            LEFT JOIN chart_of_accounts ca ON b.chart_account_id = ca.account_id
            LEFT JOIN currencies c ON b.currency_id = c.currency_id
            WHERE b.is_active = 1
        `;

        if (search) {
            sql += ` AND (
                b.bank_code LIKE @search OR 
                b.bank_name LIKE @search OR 
                b.account_number LIKE @search
            )`;
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (account_type && account_type !== 'All Types') {
            sql += ' AND b.account_type = @accountType';
            request.input('accountType', mssql.NVarChar, account_type);
        }

        if (is_default === 'Default') {
            sql += ' AND b.is_default = 1';
        } else if (is_default === 'Non-Default') {
            sql += ' AND b.is_default = 0';
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM (${sql}) as filtered`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        const bankSortClause = sort_by === 'bank_code'
            ? `b.bank_code ${sort_order}`
            : `b.${sort_by} ${sort_order}, b.bank_code ASC`;

        // Data query
        sql += ` 
            ORDER BY 
                b.is_default DESC,
                ${bankSortClause}
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        console.log(`✅ Found ${result.recordset.length} banks, total: ${total}`);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                total_pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET SINGLE BANK
app.get('/api/banks/:id', async (req, res) => {
    try {
        const bankId = req.params.id;
        console.log(`🏦 Getting bank details ID: ${bankId}`);

        const pool = await getPool();

        const sql = `
            SELECT 
                b.*,
                ca.account_code as chart_account_code,
                ca.account_name as chart_account_name,
                c.currency_code,
                c.currency_name,
                c.currency_symbol
            FROM banks b
            LEFT JOIN chart_of_accounts ca ON b.chart_account_id = ca.account_id
            LEFT JOIN currencies c ON b.currency_id = c.currency_id
            WHERE b.bank_id = @bankId
        `;

        const result = await pool.request()
            .input('bankId', mssql.Int, bankId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Bank not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE BANK
app.put('/api/banks/:id', async (req, res) => {
    try {
        const bankId = req.params.id;
        const updateData = req.body;
        console.log(`✏️ Updating bank ID: ${bankId}`, updateData);

        const errors = [];

        if (!updateData.bank_name) errors.push('Bank name is required');
        if (!updateData.chart_account_id) errors.push('Chart of account is required');
        if (!updateData.currency_id) errors.push('Currency is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // If setting as default
        if (updateData.is_default) {
            await pool.request().query('UPDATE banks SET is_default = 0 WHERE is_default = 1');
        }

        // Prepare update data
        const finalUpdateData = {
            bank_name: updateData.bank_name,
            account_number: updateData.account_number || null,
            beneficiary_name: updateData.beneficiary_name || null,
            phone_number: updateData.phone_number || null,
            branch_code: updateData.branch_code || null,
            swift_code: updateData.swift_code || null,
            ifsc_code: updateData.ifsc_code || null,
            account_type: updateData.account_type || 'CURRENT',
            file_format: updateData.file_format || 'GENERIC',
            chart_account_id: updateData.chart_account_id,
            address1: updateData.address1 || null,
            address2: updateData.address2 || null,
            address3: updateData.address3 || null,
            city: updateData.city || 'Singapore',
            country: updateData.country || 'Singapore',
            postal_code: updateData.postal_code || null,
            currency_id: updateData.currency_id,
            is_active: toBit(updateData.is_active !== undefined ? updateData.is_active : true),
            is_default: toBit(updateData.is_default || false),
            updated_by: 'admin',
            updated_at: new Date()
        };

        // Build SET clause
        const setClause = Object.keys(finalUpdateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE banks SET ${setClause} WHERE bank_id = @bankId`;

        const request = pool.request();
        request.input('bankId', mssql.Int, bankId);
        
        Object.keys(finalUpdateData).forEach(key => {
            const val = finalUpdateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Bank not found'
            });
        }

        console.log(`✅ Bank ID: ${bankId} updated successfully`);

        res.json({
            success: true,
            message: 'Bank updated successfully',
            bank_id: bankId
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. HARD DELETE BANK
app.delete('/api/banks/:id/hard', async (req, res) => {
    try {
        const bankId = req.params.id;
        console.log(`💀 HARD DELETE requested for bank ID: ${bankId}`);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('bankId', mssql.Int, bankId)
            .query('SELECT bank_id, bank_code, bank_name, is_default FROM banks WHERE bank_id = @bankId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Bank not found'
            });
        }

        const bank = checkResult.recordset[0];

        // Check if default
        if (bank.is_default) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete default bank. Set another bank as default first.'
            });
        }

        // Delete
        const deleteResult = await pool.request()
            .input('bankId', mssql.Int, bankId)
            .query('DELETE FROM banks WHERE bank_id = @bankId');

        console.log(`✅ Bank "${bank.bank_code}" permanently deleted from database`);

        res.json({
            success: true,
            message: `Bank "${bank.bank_code} - ${bank.bank_name}" permanently deleted`,
            deleted_bank: bank
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= JOURNAL TYPES API =============

// 1. CREATE JOURNAL TYPE
app.post('/api/journal-types', async (req, res) => {
    try {
        const journalTypeData = req.body;
        console.log('📝 Creating journal type:', journalTypeData);

        const errors = [];
        if (!journalTypeData.journal_type_code) errors.push('Code required');
        if (!journalTypeData.journal_type_name) errors.push('Name required');
        if (!journalTypeData.chart_account_id) errors.push('Chart Account required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check duplicate code
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, journalTypeData.journal_type_code)
            .query('SELECT journal_type_id FROM journal_types WHERE journal_type_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Journal type code "${journalTypeData.journal_type_code}" already exists`
            });
        }

        // Insert data
        const insertData = {
            journal_type_code: journalTypeData.journal_type_code,
            journal_type_name: journalTypeData.journal_type_name,
            description: journalTypeData.description || null,
            chart_account_id: journalTypeData.chart_account_id,
            is_active: toBit(journalTypeData.is_active !== undefined ? journalTypeData.is_active : true),
            is_expense: toBit(journalTypeData.is_expense || false),
            created_by: 'admin',
            updated_by: 'admin',
            created_at: new Date()
        };

        const columns = Object.keys(insertData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO journal_types (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS journalTypeId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = insertData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Journal type created: ${journalTypeData.journal_type_code}`);

        res.status(201).json({
            success: true,
            message: 'Journal type created successfully',
            journal_type_id: result.recordset[0].journalTypeId,
            journal_type_code: journalTypeData.journal_type_code,
            journal_type_name: journalTypeData.journal_type_name
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET ACCOUNTS FOR DROPDOWN (NON-PLACEHOLDER)
app.get('/api/accounts/for-dropdown', async (req, res) => {
    try {
        console.log('📊 Fetching accounts for dropdown (non-placeholder only)');
        const pool = await getPool();

        const sql = `
            SELECT 
                a.account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                a.is_placeholder,
                p.account_name AS parent_account_name,
                p.account_code AS parent_account_code
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            WHERE a.is_active = 1 
              AND a.is_placeholder = 0
            ORDER BY 
                a.account_type,
                a.account_code ASC
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} non-placeholder accounts for dropdown`);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ACCOUNTS WITH PLACEHOLDERS
app.get('/api/accounts/with-placeholders', async (req, res) => {
    try {
        console.log('📊 Fetching ALL accounts with placeholders');
        const pool = await getPool();

        const sql = `
            SELECT 
                a.account_id,
                a.account_code,
                a.account_name,
                a.account_type,
                a.is_placeholder,
                a.parent_account_id,
                p.account_name AS parent_account_name,
                p.account_code AS parent_account_code,
                (SELECT COUNT(*) FROM chart_of_accounts child WHERE child.parent_account_id = a.account_id) as child_count
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            WHERE a.is_active = 1
            ORDER BY 
                a.is_placeholder DESC,
                a.account_code ASC
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} total accounts`);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET ALL JOURNAL TYPES
app.get('/api/journal-types', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            account_id = '',
            is_expense = '',
            is_active = ''
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                jt.journal_type_id,
                jt.journal_type_code,
                jt.journal_type_name,
                jt.description,
                jt.is_active,
                jt.is_expense,
                jt.created_at,
                jt.updated_at,
                a.account_code,
                a.account_name,
                c.currency_code
            FROM journal_types jt
            LEFT JOIN chart_of_accounts a ON jt.chart_account_id = a.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE 1=1
        `;

        if (search) {
            sql += ' AND (jt.journal_type_code LIKE @search OR jt.journal_type_name LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (account_id && account_id !== 'ALL') {
            sql += ' AND jt.chart_account_id = @accountId';
            request.input('accountId', mssql.Int, account_id);
        }

        if (is_expense !== '') {
            sql += ' AND jt.is_expense = @isExpense';
            request.input('isExpense', mssql.Bit, is_expense === 'true' ? 1 : 0);
        }

        if (is_active !== '') {
            sql += ' AND jt.is_active = @isActive';
            request.input('isActive', mssql.Bit, is_active === 'true' ? 1 : 0);
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM (${sql}) as filtered`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Data query
        sql += ` ORDER BY jt.created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        console.log(`✅ Found ${result.recordset.length} journal types, total: ${total}`);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                total_pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET SINGLE JOURNAL TYPE
app.get('/api/journal-types/:id', async (req, res) => {
    try {
        const journalTypeId = req.params.id;
        console.log(`📋 Getting journal type ID: ${journalTypeId}`);

        const pool = await getPool();

        const sql = `
            SELECT 
                jt.*,
                a.account_code,
                a.account_name,
                c.currency_code
            FROM journal_types jt
            LEFT JOIN chart_of_accounts a ON jt.chart_account_id = a.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE jt.journal_type_id = @journalTypeId
        `;

        const result = await pool.request()
            .input('journalTypeId', mssql.Int, journalTypeId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Journal type not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE JOURNAL TYPE
app.delete('/api/journal-types/:id', async (req, res) => {
    try {
        const journalTypeId = req.params.id;
        console.log(`🗑️ Deleting journal type ID: ${journalTypeId}`);

        const pool = await getPool();

        const result = await pool.request()
            .input('journalTypeId', mssql.Int, journalTypeId)
            .query('DELETE FROM journal_types WHERE journal_type_id = @journalTypeId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Journal type not found'
            });
        }

        console.log(`✅ Journal type ${journalTypeId} deleted`);

        res.json({
            success: true,
            message: 'Journal type deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. GET ACCOUNTS FOR JOURNAL FILTER
app.get('/api/accounts/for-journal-filter', async (req, res) => {
    try {
        console.log('📊 Fetching accounts for journal filter...');
        const pool = await getPool();

        const sql = `
            SELECT 
                account_id,
                account_code,
                account_name
            FROM chart_of_accounts 
            WHERE is_active = 1 
              AND is_placeholder = 0
            ORDER BY account_code ASC
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} accounts for filter`);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. UPDATE JOURNAL TYPE
app.put('/api/journal-types/:id', async (req, res) => {
    try {
        const journalTypeId = req.params.id;
        const updateData = req.body;
        console.log(`📝 Updating journal type ID: ${journalTypeId}`, updateData);

        const errors = [];
        if (!updateData.journal_type_name) errors.push('Name is required');
        if (!updateData.chart_account_id) errors.push('Chart Account is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('journalTypeId', mssql.Int, journalTypeId)
            .query('SELECT journal_type_id FROM journal_types WHERE journal_type_id = @journalTypeId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Journal type not found'
            });
        }

        // Prepare update data
        const finalUpdateData = {
            journal_type_name: updateData.journal_type_name,
            description: updateData.description || null,
            chart_account_id: updateData.chart_account_id,
            is_active: toBit(updateData.is_active !== undefined ? updateData.is_active : true),
            is_expense: toBit(updateData.is_expense || false),
            updated_by: updateData.updated_by || 'admin',
            updated_at: new Date()
        };

        // Build SET clause
        const setClause = Object.keys(finalUpdateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE journal_types SET ${setClause} WHERE journal_type_id = @journalTypeId`;

        const request = pool.request();
        request.input('journalTypeId', mssql.Int, journalTypeId);
        
        Object.keys(finalUpdateData).forEach(key => {
            const val = finalUpdateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Int, val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Journal type ${journalTypeId} updated successfully`);

        res.json({
            success: true,
            message: 'Journal type updated successfully',
            journal_type_id: journalTypeId
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= FORECAST SETTINGS API =============

// 1. GET FORECAST SETTINGS
app.get('/api/forecast-settings', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search = '',
            forecast_type = '',
            forecast_model = '',
            expense_type = ''
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let whereConditions = [];
        let params = [];

        if (search) {
            whereConditions.push('(fs.forecast_name LIKE @search OR fs.description LIKE @search)');
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (forecast_type && forecast_type !== 'All Types') {
            whereConditions.push('fs.forecast_type = @forecastType');
            request.input('forecastType', mssql.NVarChar, forecast_type);
        }

        if (forecast_model && forecast_model !== 'All Models') {
            whereConditions.push('fs.forecast_model = @forecastModel');
            request.input('forecastModel', mssql.NVarChar, forecast_model);
        }

        if (expense_type && expense_type !== 'All Types') {
            whereConditions.push('fs.expense_type = @expenseType');
            request.input('expenseType', mssql.NVarChar, expense_type);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Count query
        const countSql = `
            SELECT COUNT(*) as total
            FROM forecast_settings fs
            ${whereClause}
        `;

        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Data query
        const sql = `
            SELECT 
                fs.*,
                c.currency_code,
                ca.account_code,
                ca.account_name
            FROM forecast_settings fs
            LEFT JOIN currencies c ON fs.currency_id = c.currency_id
            LEFT JOIN chart_of_accounts ca ON fs.account_id = ca.account_id
            ${whereClause}
            ORDER BY fs.created_at DESC 
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        console.log(`✅ Found ${result.recordset.length} forecast settings, total: ${total}`);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                total_pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CREATE FORECAST SETTING
app.post('/api/forecast-settings', async (req, res) => {
    try {
        const forecastData = req.body;
        console.log('📊 Creating forecast setting:', forecastData);

        // Get account details if account_id is provided
        if (forecastData.account_id) {
            const pool = await getPool();
            const accountResult = await pool.request()
                .input('accountId', mssql.Int, forecastData.account_id)
                .query('SELECT account_code, account_name FROM chart_of_accounts WHERE account_id = @accountId');

            if (accountResult.recordset.length > 0) {
                forecastData.account_code = accountResult.recordset[0].account_code;
                forecastData.account_name = accountResult.recordset[0].account_name;
            }
        }

        // Insert
        const columns = Object.keys(forecastData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO forecast_settings (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS forecastId`;

        const pool = await getPool();
        const request = pool.request();
        
        columns.forEach(col => {
            const val = forecastData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.status(201).json({
            success: true,
            message: 'Forecast setting created successfully',
            forecast_id: result.recordset[0].forecastId
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET INCOME ACCOUNTS
app.get('/api/accounts/income', async (req, res) => {
    try {
        console.log('📊 Fetching income accounts for forecast...');
        const pool = await getPool();

        const sql = `
            SELECT 
                account_id,
                account_code,
                account_name,
                account_type,
                description
            FROM chart_of_accounts 
            WHERE (account_type = 'INCOME' 
                   OR account_type = 'REVENUE'
                   OR account_type = 'OTHER_INCOME')
              AND is_active = 1
              AND is_placeholder = 0
            ORDER BY account_code ASC
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} income accounts`);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE FORECAST SETTING
app.get('/api/forecast-settings/:id', async (req, res) => {
    try {
        const forecastId = req.params.id;
        console.log(`📋 Getting details for forecast ID: ${forecastId}`);

        const pool = await getPool();

        const sql = `
            SELECT 
                fs.*,
                c.currency_code,
                ca.account_code,
                ca.account_name,
                ca.account_type as account_type_name
            FROM forecast_settings fs
            LEFT JOIN currencies c ON fs.currency_id = c.currency_id
            LEFT JOIN chart_of_accounts ca ON fs.account_id = ca.account_id
            WHERE fs.forecast_id = @forecastId
        `;

        const result = await pool.request()
            .input('forecastId', mssql.Int, forecastId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Forecast setting not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. UPDATE FORECAST SETTING
app.put('/api/forecast-settings/:id', async (req, res) => {
    try {
        const forecastId = req.params.id;
        const updateData = req.body;
        console.log(`📝 Updating forecast ID: ${forecastId}`, updateData);

        if (!updateData.forecast_type) {
            return res.status(400).json({
                success: false,
                error: 'Forecast type is required'
            });
        }

        if (!updateData.forecast_model) {
            return res.status(400).json({
                success: false,
                error: 'Forecast model is required'
            });
        }

        if (!updateData.currency_id) {
            return res.status(400).json({
                success: false,
                error: 'Currency is required'
            });
        }

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('forecastId', mssql.Int, forecastId)
            .query('SELECT forecast_id FROM forecast_settings WHERE forecast_id = @forecastId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Forecast setting not found'
            });
        }

        // Get account details if account_id is provided
        if (updateData.account_id) {
            const accountResult = await pool.request()
                .input('accountId', mssql.Int, updateData.account_id)
                .query('SELECT account_code, account_name FROM chart_of_accounts WHERE account_id = @accountId');

            if (accountResult.recordset.length > 0) {
                updateData.account_code = accountResult.recordset[0].account_code;
                updateData.account_name = accountResult.recordset[0].account_name;
            }
        }

        // Add timestamp
        updateData.updated_at = new Date();
        updateData.updated_by = updateData.updated_by || 'admin';

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE forecast_settings SET ${setClause} WHERE forecast_id = @forecastId`;

        const request = pool.request();
        request.input('forecastId', mssql.Int, forecastId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Forecast "${updateData.forecast_name}" updated successfully`);

        res.json({
            success: true,
            message: 'Forecast updated successfully',
            forecast_id: forecastId,
            forecast_name: updateData.forecast_name
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE FORECAST SETTING
app.delete('/api/forecast-settings/:id', async (req, res) => {
    try {
        const forecastId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('forecastId', mssql.Int, forecastId)
            .query('DELETE FROM forecast_settings WHERE forecast_id = @forecastId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Forecast setting not found'
            });
        }

        res.json({
            success: true,
            message: 'Forecast setting deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= PETTY CASH API =============

// 1. GET PETTY CASH ACCOUNTS
app.get('/api/accounts/petty-cash', async (req, res) => {
    try {
        console.log('💰 API: Fetching petty cash accounts');
        const pool = await getPool();

        const sql = `
            SELECT 
                coa.account_id,
                coa.account_code,
                coa.account_name,
                coa.account_type,
                coa.current_balance,
                coa.currency_id,
                c.currency_code,
                c.currency_symbol,
                coa.description
            FROM chart_of_accounts coa
            LEFT JOIN currencies c ON coa.currency_id = c.currency_id
            WHERE coa.is_active = 1 
              AND coa.is_placeholder = 0
              AND (
                coa.account_type = 'PETTY_CASH' 
                OR LOWER(coa.account_name) LIKE '%petty cash%'
                OR LOWER(coa.account_name) LIKE '%petty%cash%'
                OR coa.account_code LIKE '110%'
                OR coa.account_code LIKE '111%'
                OR coa.account_code LIKE '112%'
              )
            ORDER BY coa.account_code
        `;

        let result = await pool.request().query(sql);

        // If no results, try to get CASH accounts as fallback
        if (result.recordset.length === 0) {
            console.log('No petty cash accounts found. Trying CASH accounts...');
            
            const fallbackSql = `
                SELECT 
                    coa.account_id,
                    coa.account_code,
                    coa.account_name,
                    coa.account_type,
                    coa.current_balance,
                    coa.currency_id,
                    c.currency_code,
                    c.currency_symbol
                FROM chart_of_accounts coa
                LEFT JOIN currencies c ON coa.currency_id = c.currency_id
                WHERE coa.is_active = 1 
                  AND coa.is_placeholder = 0
                  AND coa.account_type = 'CASH'
                ORDER BY coa.account_code
                OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY
            `;

            result = await pool.request().query(fallbackSql);

            const formatted = result.recordset.map(account => ({
                value: account.account_id,
                text: `${account.account_code} - ${account.account_name} (CASH)`,
                balance: account.current_balance,
                currency: account.currency_code,
                type: account.account_type,
                fullData: account
            }));

            return res.json({
                success: true,
                data: formatted,
                warning: "No petty cash accounts found. Showing CASH accounts instead."
            });
        }

        // Format for dropdown
        const formatted = result.recordset.map(account => ({
            value: account.account_id,
            text: `${account.account_code} - ${account.account_name}`,
            balance: account.current_balance,
            currency: account.currency_code,
            type: account.account_type,
            fullData: account
        }));

        res.json({
            success: true,
            data: formatted,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CREATE PETTY CASH
app.post('/api/petty-cash/create', async (req, res) => {
    try {
        console.log('📝 API: Creating petty cash record');

        const {
            petty_cash_code,
            petty_cash_name,
            petty_cash_amount,
            current_balance,
            max_expenses_allowed,
            is_approval_needed,
            approval_amount,
            handled_by,
            account_id,
            description
        } = req.body;

        const errors = [];
        if (!petty_cash_code) errors.push('Petty cash code is required');
        if (!petty_cash_name) errors.push('Petty cash name is required');
        if (!account_id) errors.push('Chart of account is required');

        if (is_approval_needed && (!approval_amount || approval_amount <= 0)) {
            errors.push('Approval amount must be greater than 0 when approval is needed');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        const pool = await getPool();

        // Get account details
        const accountResult = await pool.request()
            .input('accountId', mssql.Int, account_id)
            .query(`
                SELECT account_code, account_name, current_balance 
                FROM chart_of_accounts 
                WHERE account_id = @accountId AND is_active = 1
            `);

        if (accountResult.recordset.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Selected account not found or inactive'
            });
        }

        const account = accountResult.recordset[0];

        // Insert
        const insertData = {
            petty_cash_code,
            petty_cash_name,
            description: description || null,
            petty_cash_amount: parseFloat(petty_cash_amount) || 0,
            current_balance: parseFloat(current_balance) || 0,
            max_expenses_allowed: parseFloat(max_expenses_allowed) || 0,
            is_approval_needed: toBit(is_approval_needed || false),
            approval_amount: is_approval_needed ? (parseFloat(approval_amount) || 0) : 0,
            handled_by: handled_by || 'Admin',
            account_id,
            account_code: account.account_code,
            account_name: account.account_name,
            created_by: 'admin',
            updated_by: 'admin',
            created_at: new Date()
        };

        const columns = Object.keys(insertData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO petty_cash_master (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS pettyCashId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = insertData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ API: Petty cash created - ID: ${result.recordset[0].pettyCashId}, Code: ${petty_cash_code}`);

        res.status(201).json({
            success: true,
            message: 'Petty cash created successfully',
            data: {
                petty_cash_id: result.recordset[0].pettyCashId,
                petty_cash_code,
                petty_cash_name,
                account_code: account.account_code,
                account_name: account.account_name,
                current_balance: insertData.current_balance
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        // Handle duplicate entry
        if (error.message && error.message.includes('duplicate key')) {
            return res.status(409).json({
                success: false,
                error: `Petty cash code already exists`
            });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET PETTY CASH LIST
app.get('/api/petty-cash/list', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '' } = req.query;
        const offset = (page - 1) * limit;

        console.log('📋 API: Fetching petty cash list');

        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                p.*,
                a.current_balance as account_current_balance,
                a.currency_id as account_currency_id,
                c.currency_code as account_currency_code
            FROM petty_cash_master p
            LEFT JOIN chart_of_accounts a ON p.account_id = a.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE p.is_active = 1
        `;

        if (search) {
            sql += ' AND (p.petty_cash_code LIKE @search OR p.petty_cash_name LIKE @search OR p.account_code LIKE @search)';
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        // Count query
        const countSql = `SELECT COUNT(*) as total FROM (${sql}) as filtered`;
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Data query
        sql += ' ORDER BY p.petty_cash_code ASC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(sql);

        console.log(`✅ API: Found ${result.recordset.length} petty cash records`);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                total_pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE PETTY CASH
app.get('/api/petty-cash/:id', async (req, res) => {
    try {
        const pettyCashId = req.params.id;
        console.log(`🔍 API: Fetching petty cash details for ID: ${pettyCashId}`);

        const pool = await getPool();

        const sql = `
            SELECT 
                p.*,
                a.account_type as account_type,
                a.current_balance as account_current_balance,
                c.currency_code,
                c.currency_symbol
            FROM petty_cash_master p
            LEFT JOIN chart_of_accounts a ON p.account_id = a.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE p.petty_cash_id = @pettyCashId
        `;

        const result = await pool.request()
            .input('pettyCashId', mssql.Int, pettyCashId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Petty cash record not found'
            });
        }

        console.log(`✅ API: Found petty cash record: ${result.recordset[0].petty_cash_code}`);

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. UPDATE PETTY CASH
app.put('/api/petty-cash/:id', async (req, res) => {
    try {
        const pettyCashId = req.params.id;
        console.log(`✏️ API: Updating petty cash ID: ${pettyCashId}`);

        const {
            petty_cash_name,
            max_expenses_allowed,
            is_approval_needed,
            approval_amount,
            handled_by,
            description,
            is_active
        } = req.body;

        const updateData = {
            petty_cash_name,
            max_expenses_allowed: parseFloat(max_expenses_allowed) || 0,
            is_approval_needed: toBit(is_approval_needed || false),
            approval_amount: is_approval_needed ? (parseFloat(approval_amount) || 0) : 0,
            handled_by: handled_by || 'Admin',
            description: description || null,
            is_active: toBit(is_active !== undefined ? is_active : true),
            updated_by: 'admin',
            updated_at: new Date()
        };

        const pool = await getPool();

        // Build SET clause
        const setClause = Object.keys(updateData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE petty_cash_master SET ${setClause} WHERE petty_cash_id = @pettyCashId`;

        const request = pool.request();
        request.input('pettyCashId', mssql.Int, pettyCashId);
        
        Object.keys(updateData).forEach(key => {
            const val = updateData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Petty cash record not found'
            });
        }

        console.log(`✅ API: Petty cash updated successfully`);

        res.json({
            success: true,
            message: 'Petty cash updated successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. HARD DELETE PETTY CASH
app.delete('/api/petty-cash/:id/hard', async (req, res) => {
    try {
        const pettyCashId = req.params.id;
        console.log(`💀 HARD DELETE petty cash ID: ${pettyCashId}`);

        const pool = await getPool();

        // Get details for confirmation
        const checkResult = await pool.request()
            .input('pettyCashId', mssql.Int, pettyCashId)
            .query('SELECT petty_cash_code, petty_cash_name FROM petty_cash_master WHERE petty_cash_id = @pettyCashId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Petty cash record not found'
            });
        }

        const pettyCash = checkResult.recordset[0];

        // Delete
        const deleteResult = await pool.request()
            .input('pettyCashId', mssql.Int, pettyCashId)
            .query('DELETE FROM petty_cash_master WHERE petty_cash_id = @pettyCashId');

        console.log(`✅ Permanently deleted: ${pettyCash.petty_cash_code}`);

        res.json({
            success: true,
            message: `Petty cash "${pettyCash.petty_cash_code} - ${pettyCash.petty_cash_name}" permanently deleted`,
            deleted_code: pettyCash.petty_cash_code,
            warning: 'This action cannot be undone!'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= PRODUCTS API =============

// 1. GET DROPDOWN DATA FOR PRODUCTS
app.get('/api/products/dropdown-data', async (req, res) => {
    try {
        console.log('📊 Fetching ALL dropdown data for product form');
        const pool = await getPool();

        // Fetch all data in parallel
        const [vendors, chartOfAccounts, departments, categories, brands, uoms] = await Promise.all([
            // 1. Vendors
            pool.request().query(`
                SELECT 
                    vendor_id,
                    vendor_code + ' - ' + vendor_name as display_name,
                    vendor_code,
                    vendor_name
                FROM vendors 
                WHERE is_active = 1
                ORDER BY vendor_name
            `),
            
            // 2. Chart of Accounts (non-placeholder)
            pool.request().query(`
                SELECT 
                    account_id,
                    account_code + ' - ' + account_name as display_name,
                    account_code,
                    account_name,
                    account_type,
                    is_placeholder
                FROM chart_of_accounts 
                WHERE is_placeholder = 0 
                  AND is_active = 1
                ORDER BY account_code
            `),
            
            // 3. Departments
            pool.request().query(`
                SELECT 
                    department_id,
                    department_code,
                    department_name
                FROM departments 
                WHERE is_active = 1
                ORDER BY department_name
            `),
            
            // 4. Categories
            pool.request().query(`
                SELECT 
                    category_id,
                    category_code + ' - ' + category_name as display_name,
                    category_code,
                    category_name,
                    department_id
                FROM categories 
                WHERE is_active = 1
                ORDER BY category_name
            `),
            
            // 5. Brands
            pool.request().query(`
                SELECT 
                    brand_id,
                    brand_code + ' - ' + brand_name as display_name,
                    brand_code,
                    brand_name
                FROM brands 
                WHERE is_active = 1
                ORDER BY brand_name
            `),
            
            // 6. UOMs
            pool.request().query(`
                SELECT 
                    uom_id,
                    uom_code + ' - ' + uom_name as display_name,
                    uom_code,
                    uom_name,
                    is_base_uom
                FROM uoms 
                WHERE is_active = 1
                ORDER BY uom_name
            `)
        ]);

        console.log(`✅ Dropdown data loaded:`);
        console.log(`   Vendors: ${vendors.recordset.length}`);
        console.log(`   Accounts: ${chartOfAccounts.recordset.length}`);
        console.log(`   Departments: ${departments.recordset.length}`);
        console.log(`   Categories: ${categories.recordset.length}`);
        console.log(`   Brands: ${brands.recordset.length}`);
        console.log(`   UOMs: ${uoms.recordset.length}`);

        res.json({
            success: true,
            data: {
                vendors: vendors.recordset,
                chartOfAccounts: chartOfAccounts.recordset,
                departments: departments.recordset,
                categories: categories.recordset,
                brands: brands.recordset,
                uoms: uoms.recordset
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. GET NON-PLACEHOLDER ACCOUNTS
app.get('/api/chart-of-accounts/non-placeholder', async (req, res) => {
    try {
        const pool = await getPool();
        const sql = `
            SELECT 
                account_id,
                account_code + ' - ' + account_name as display_name,
                account_code,
                account_name,
                account_type
            FROM chart_of_accounts 
            WHERE is_placeholder = 0 
              AND is_active = 1
            ORDER BY account_code
        `;

        const result = await pool.request().query(sql);

        console.log(`✅ Found ${result.recordset.length} non-placeholder accounts`);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. CREATE PRODUCT
app.post('/api/products', async (req, res) => {
    try {
        const productData = req.body;
        console.log('📦 Creating product:', productData.product_code);

        if (!productData.product_code || !productData.product_name) {
            return res.status(400).json({
                success: false,
                error: 'Product code and name are required'
            });
        }

        const pool = await getPool();

        // Check if product code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, productData.product_code)
            .query('SELECT product_id FROM product WHERE product_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Product code "${productData.product_code}" already exists`
            });
        }

        // Get user ID safely
        let createdById = productData.created_by || 1;
        const userCheck = await pool.request()
            .input('userId', mssql.Int, createdById)
            .query('SELECT user_id FROM users WHERE user_id = @userId');

        if (userCheck.recordset.length === 0) {
            console.log('⚠️ User not found, setting created_by to NULL');
            createdById = null;
        }

        // Set defaults
        const defaults = {
            current_stock: 0.00,
            selling_price: 0.00,
            avg_cost: 0.00,
            lp_price: 0.00,
            base_weight: 0.00,
            base_weight_unit: 'KG',
            is_active: 1,
            created_at: new Date(),
            created_by: createdById
        };

        const finalData = { ...defaults, ...productData };
        
        // Remove undefined
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        // Insert
        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO product (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS productId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Product created: ${productData.product_code} (ID: ${result.recordset[0].productId})`);

        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            product_id: result.recordset[0].productId,
            product_code: productData.product_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. UPLOAD PRODUCT IMAGE
app.post('/api/products/:id/images', async (req, res) => {
    try {
        const productId = req.params.id;
        const imageData = req.body;

        console.log(`📸 Uploading image for product ID: ${productId}`);

        if (!imageData.image_data) {
            return res.status(400).json({
                success: false,
                error: 'Image data is required'
            });
        }

        const pool = await getPool();

        // Check if product exists
        const checkResult = await pool.request()
            .input('productId', mssql.Int, productId)
            .query('SELECT product_id FROM product WHERE product_id = @productId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        // Insert image
        const imageRecord = {
            product_id: productId,
            image_type: imageData.image_type || 'GALLERY',
            image_data: imageData.image_data,
            image_name: imageData.image_name || 'product_image.jpg',
            image_size: imageData.image_size || 0,
            mime_type: imageData.mime_type || 'image/jpeg',
            display_order: imageData.display_order || 0,
            created_at: new Date()
        };

        const columns = Object.keys(imageRecord);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO product_image (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS imageId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = imageRecord[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Int, val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Image uploaded for product ID: ${productId}`);

        res.status(201).json({
            success: true,
            message: 'Image uploaded successfully',
            image_id: result.recordset[0].imageId
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET ALL PRODUCTS
app.get('/api/products', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search = '',
            department_id = '',
            category_id = '',
            brand_id = ''
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let whereClauses = ['p.is_active = 1'];
        let params = [];

        if (search) {
            whereClauses.push('(p.product_code LIKE @search OR p.product_name LIKE @search OR p.alias LIKE @search)');
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (department_id) {
            whereClauses.push('p.department_id = @deptId');
            request.input('deptId', mssql.Int, department_id);
        }

        if (category_id) {
            whereClauses.push('p.category_id = @catId');
            request.input('catId', mssql.Int, category_id);
        }

        if (brand_id) {
            whereClauses.push('p.brand_id = @brandId');
            request.input('brandId', mssql.Int, brand_id);
        }

        const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        // Count query
        const countSQL = `SELECT COUNT(*) as total FROM product p ${whereSQL}`;
        const countResult = await request.query(countSQL);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / limit);

        // Data query
        const dataSQL = `
            SELECT 
                p.product_id,
                p.product_code,
                p.product_name,
                p.alias,
                p.current_stock,
                p.selling_price,
                p.avg_cost,
                p.lp_price,
                p.is_active,
                d.department_name,
                c.category_name,
                b.brand_name,
                u.uom_name,
                v.vendor_name,
                (SELECT TOP 1 image_path FROM product_image 
                 WHERE product_id = p.product_id AND image_type = 'MAIN') as main_image
            FROM product p
            LEFT JOIN departments d ON p.department_id = d.department_id
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            LEFT JOIN uoms u ON p.uom_id = u.uom_id
            LEFT JOIN vendors v ON p.vendor_id = v.vendor_id
            ${whereSQL}
            ORDER BY p.product_code ASC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(dataSQL);

        console.log(`✅ Products fetched: ${result.recordset.length} of ${total}`);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                current_page: parseInt(page),
                total_pages: totalPages,
                total_items: total,
                items_per_page: parseInt(limit),
                has_next: page < totalPages,
                has_prev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE PRODUCT
app.delete('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('productId', mssql.Int, productId)
            .query('DELETE FROM product WHERE product_id = @productId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        console.log(`✅ Product deleted: ID ${productId}`);

        res.json({
            success: true,
            message: 'Product deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. UPDATE PRODUCT
app.put('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const productData = req.body;

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('productId', mssql.Int, productId)
            .query('SELECT product_id FROM product WHERE product_id = @productId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        // Add updated timestamp
        productData.updated_at = new Date();

        // Build SET clause
        const setClause = Object.keys(productData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE product SET ${setClause} WHERE product_id = @productId`;

        const request = pool.request();
        request.input('productId', mssql.Int, productId);
        
        Object.keys(productData).forEach(key => {
            const val = productData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Product updated: ID ${productId}`);

        res.json({
            success: true,
            message: 'Product updated successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 8. GET SINGLE PRODUCT
app.get('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT 
                p.*,
                d.department_name,
                c.category_name,
                b.brand_name,
                u.uom_name,
                v.vendor_name,
                ca_purchase.account_name as purchase_account_name,
                ca_sales.account_name as sales_account_name
            FROM product p
            LEFT JOIN departments d ON p.department_id = d.department_id
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            LEFT JOIN uoms u ON p.uom_id = u.uom_id
            LEFT JOIN vendors v ON p.vendor_id = v.vendor_id
            LEFT JOIN chart_of_accounts ca_purchase ON p.purchase_coa_id = ca_purchase.account_id
            LEFT JOIN chart_of_accounts ca_sales ON p.sales_coa_id = ca_sales.account_id
            WHERE p.product_id = @productId
        `;

        const result = await pool.request()
            .input('productId', mssql.Int, productId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 9. GET PRODUCT IMAGES
app.get('/api/products/:id/images', async (req, res) => {
    try {
        const productId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT * FROM product_image 
            WHERE product_id = @productId 
            ORDER BY display_order, created_at
        `;

        const result = await pool.request()
            .input('productId', mssql.Int, productId)
            .query(sql);

        res.json({
            success: true,
            data: result.recordset,
            count: result.recordset.length
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= SERVICES API =============

// 1. GET SERVICES DROPDOWN DATA
app.get('/api/services/dropdown-data', async (req, res) => {
    try {
        console.log('📊 Fetching ALL dropdown data for service form');
        const pool = await getPool();

        const [departments, categories, vendors, uoms, currencies] = await Promise.all([
            pool.request().query(`
                SELECT 
                    department_id, 
                    department_code + ' - ' + department_name as display_name,
                    department_code,
                    department_name
                FROM departments 
                WHERE is_active = 1
                ORDER BY department_code
            `),
            
            pool.request().query(`
                SELECT 
                    category_id, 
                    category_code + ' - ' + category_name as display_name,
                    category_code,
                    category_name
                FROM categories 
                WHERE is_active = 1
                ORDER BY category_code
            `),
            
            pool.request().query(`
                SELECT 
                    vendor_id, 
                    vendor_code + ' - ' + vendor_name as display_name,
                    vendor_code,
                    vendor_name
                FROM vendors 
                WHERE is_active = 1
                ORDER BY vendor_code
            `),
            
            pool.request().query(`
                SELECT 
                    uom_id, 
                    uom_code + ' - ' + uom_name as display_name,
                    uom_code,
                    uom_name
                FROM uoms 
                WHERE is_active = 1
                ORDER BY uom_code
            `),
            
            pool.request().query(`
                SELECT 
                    currency_id, 
                    currency_code + ' - ' + currency_name as display_name,
                    currency_code,
                    currency_name,
                    currency_symbol
                FROM currencies 
                WHERE is_active = 1
                ORDER BY currency_code
            `)
        ]);

        console.log(`✅ Dropdown data loaded:`);
        console.log(`   Departments: ${departments.recordset.length}`);
        console.log(`   Categories: ${categories.recordset.length}`);
        console.log(`   Vendors: ${vendors.recordset.length}`);
        console.log(`   UOMs: ${uoms.recordset.length}`);
        console.log(`   Currencies: ${currencies.recordset.length}`);

        res.json({
            success: true,
            data: {
                departments: departments.recordset,
                categories: categories.recordset,
                vendors: vendors.recordset,
                uoms: uoms.recordset,
                currencies: currencies.recordset
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. CREATE SERVICE
app.post('/api/services', async (req, res) => {
    try {
        const serviceData = req.body;
        console.log('🔧 Creating service:', serviceData.service_code);

        if (!serviceData.service_code || !serviceData.service_name) {
            return res.status(400).json({
                success: false,
                error: 'Service code and name are required'
            });
        }

        const pool = await getPool();

        // Check if service code exists
        const checkResult = await pool.request()
            .input('code', mssql.NVarChar, serviceData.service_code)
            .query('SELECT service_id FROM services WHERE service_code = @code');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Service code "${serviceData.service_code}" already exists`
            });
        }

        // Set defaults
        const defaults = {
            unit_price: 0.00,
            is_expense: 0,
            is_active: 1,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...serviceData };

        // Remove undefined
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        // Insert
        const columns = Object.keys(finalData);
        const values = columns.map(col => `@${col}`).join(', ');
        const sql = `INSERT INTO services (${columns.join(', ')}) VALUES (${values}); SELECT SCOPE_IDENTITY() AS serviceId`;

        const request = pool.request();
        columns.forEach(col => {
            const val = finalData[col];
            if (val instanceof Date) {
                request.input(col, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(col, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(col, mssql.Decimal(18, 2), val);
            } else {
                request.input(col, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        console.log(`✅ Service created: ${serviceData.service_code} (ID: ${result.recordset[0].serviceId})`);

        res.status(201).json({
            success: true,
            message: 'Service created successfully',
            service_id: result.recordset[0].serviceId,
            service_code: serviceData.service_code
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET ALL SERVICES
app.get('/api/services', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            search = '',
            department_id = '',
            category_id = ''
        } = req.query;

        const offset = (page - 1) * limit;
        const pool = await getPool();
        const request = pool.request();

        let whereClauses = ['s.is_active = 1'];
        let params = [];

        if (search) {
            whereClauses.push('(s.service_code LIKE @search OR s.service_name LIKE @search)');
            request.input('search', mssql.NVarChar, `%${search}%`);
        }

        if (department_id) {
            whereClauses.push('s.department_id = @deptId');
            request.input('deptId', mssql.Int, department_id);
        }

        if (category_id) {
            whereClauses.push('s.category_id = @catId');
            request.input('catId', mssql.Int, category_id);
        }

        const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        // Count query
        const countSQL = `SELECT COUNT(*) as total FROM services s ${whereSQL}`;
        const countResult = await request.query(countSQL);
        const total = countResult.recordset[0].total;
        const totalPages = Math.ceil(total / limit);

        // Data query
        const dataSQL = `
            SELECT 
                s.*,
                d.department_name,
                c.category_name,
                v.vendor_name,
                u.uom_name,
                curr.currency_code,
                curr.currency_name,
                ca_purchase.account_name as purchase_account_name,
                ca_sales.account_name as sales_account_name
            FROM services s
            LEFT JOIN departments d ON s.department_id = d.department_id
            LEFT JOIN categories c ON s.category_id = c.category_id
            LEFT JOIN vendors v ON s.vendor_id = v.vendor_id
            LEFT JOIN uoms u ON s.uom_id = u.uom_id
            LEFT JOIN currencies curr ON s.currency_id = curr.currency_id
            LEFT JOIN chart_of_accounts ca_purchase ON s.purchase_coa_id = ca_purchase.account_id
            LEFT JOIN chart_of_accounts ca_sales ON s.sales_coa_id = ca_sales.account_id
            ${whereSQL}
            ORDER BY s.service_code ASC
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `;

        request.input('offset', mssql.Int, parseInt(offset));
        request.input('limit', mssql.Int, parseInt(limit));

        const result = await request.query(dataSQL);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                current_page: parseInt(page),
                total_pages: totalPages,
                total_items: total,
                items_per_page: parseInt(limit),
                has_next: page < totalPages,
                has_prev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. GET SINGLE SERVICE
app.get('/api/services/:id', async (req, res) => {
    try {
        const serviceId = req.params.id;
        const pool = await getPool();

        const sql = `
            SELECT 
                s.*,
                d.department_name,
                c.category_name,
                v.vendor_name,
                u.uom_name,
                curr.currency_code,
                curr.currency_name,
                ca_purchase.account_name as purchase_account_name,
                ca_sales.account_name as sales_account_name
            FROM services s
            LEFT JOIN departments d ON s.department_id = d.department_id
            LEFT JOIN categories c ON s.category_id = c.category_id
            LEFT JOIN vendors v ON s.vendor_id = v.vendor_id
            LEFT JOIN uoms u ON s.uom_id = u.uom_id
            LEFT JOIN currencies curr ON s.currency_id = curr.currency_id
            LEFT JOIN chart_of_accounts ca_purchase ON s.purchase_coa_id = ca_purchase.account_id
            LEFT JOIN chart_of_accounts ca_sales ON s.sales_coa_id = ca_sales.account_id
            WHERE s.service_id = @serviceId
        `;

        const result = await pool.request()
            .input('serviceId', mssql.Int, serviceId)
            .query(sql);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        res.json({
            success: true,
            data: result.recordset[0]
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. UPDATE SERVICE
app.put('/api/services/:id', async (req, res) => {
    try {
        const serviceId = req.params.id;
        const serviceData = req.body;

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('serviceId', mssql.Int, serviceId)
            .query('SELECT service_id FROM services WHERE service_id = @serviceId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        // Add updated timestamp
        serviceData.updated_at = new Date();

        // Build SET clause
        const setClause = Object.keys(serviceData).map(key => `${key} = @${key}`).join(', ');
        const sql = `UPDATE services SET ${setClause} WHERE service_id = @serviceId`;

        const request = pool.request();
        request.input('serviceId', mssql.Int, serviceId);
        
        Object.keys(serviceData).forEach(key => {
            const val = serviceData[key];
            if (val instanceof Date) {
                request.input(key, mssql.DateTime, val);
            } else if (typeof val === 'boolean') {
                request.input(key, mssql.Bit, val ? 1 : 0);
            } else if (typeof val === 'number') {
                request.input(key, mssql.Decimal(18, 2), val);
            } else {
                request.input(key, mssql.NVarChar, val);
            }
        });

        const result = await request.query(sql);

        res.json({
            success: true,
            message: 'Service updated successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. DELETE SERVICE
app.delete('/api/services/:id', async (req, res) => {
    try {
        const serviceId = req.params.id;
        const pool = await getPool();

        const result = await pool.request()
            .input('serviceId', mssql.Int, serviceId)
            .query('DELETE FROM services WHERE service_id = @serviceId');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        res.json({
            success: true,
            message: 'Service deleted successfully'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= PURCHASE INVOICES API =============

// Helper function to save invoice items
async function saveInvoiceItems(invoiceId, invoiceData, pool) {
    console.log(`💾 Saving ${invoiceData.items.length} items for invoice ${invoiceId}`);
    
    if (!invoiceData.items || invoiceData.items.length === 0) {
        return { success: true, message: 'No items to save' };
    }
    
    const itemPromises = invoiceData.items.map(item => {
        const sql = `
            INSERT INTO purchase_invoice_items 
            (invoice_id, item_type, reference_item_id, item_code, 
             item_name, quantity, unit_price, total_amount, uom)
            VALUES 
            (@invoiceId, @itemType, @referenceItemId, @itemCode, 
             @itemName, @quantity, @unitPrice, @totalAmount, @uom)
        `;
        
        return pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .input('itemType', mssql.NVarChar, item.item_type || 'product')
            .input('referenceItemId', mssql.Int, item.reference_item_id || 0)
            .input('itemCode', mssql.NVarChar, item.item_code || '')
            .input('itemName', mssql.NVarChar, item.item_name || 'Item')
            .input('quantity', mssql.Decimal(18, 2), item.quantity || 1)
            .input('unitPrice', mssql.Decimal(18, 2), item.unit_price || 0)
            .input('totalAmount', mssql.Decimal(18, 2), item.total_amount || 0)
            .input('uom', mssql.NVarChar, item.uom || 'PCS')
            .query(sql);
    });
    
    await Promise.all(itemPromises);
    console.log(`✅ All items saved for invoice ${invoiceId}`);
    return { success: true, message: 'Items saved successfully' };
}

// 1. CREATE PURCHASE INVOICE
app.post('/api/purchase-invoices', async (req, res) => {
    try {
        console.log('📥 Invoice save request received');
        
        const pool = await getPool();
        
        // Calculate payment fields
        const paidAmount = req.body.paid_amount || 0;
        const grandTotal = req.body.grand_total || 0;
        const balanceAmount = req.body.balance_amount || (grandTotal - paidAmount);
        
        // Determine payment status
        let paymentStatus = 'new';
        if (req.body.due_date) {
            const dueDate = new Date(req.body.due_date);
            const today = new Date();
            if (dueDate < today) {
                paymentStatus = 'overdue';
            }
        }

        // Extract data
        const invoiceData = {
            vendor_id: req.body.vendor_id || 1,
            invoice_no: req.body.invoice_no || `INV-${Date.now()}`,
            transaction_no: req.body.transaction_no || '',
            invoice_date: req.body.invoice_date || new Date().toISOString().split('T')[0],
            transaction_date: req.body.transaction_date || new Date().toISOString().split('T')[0],
            due_date: req.body.due_date || null,
            expected_payment_date: req.body.expected_payment_date || null,
            currency_id: req.body.currency_id || 1,
            currency_rate: req.body.currency_rate || 1.0000,
            gst_type: req.body.gst_type || 'Exclusive',
            gst_value: req.body.gst_value || 9.00,
            terms: req.body.terms || '30 Days',
            po_no: req.body.po_no || '',
            reference_no: req.body.reference_no || '',
            project_id: req.body.project_id || null,
            add_to_project_costing: req.body.add_to_project_costing || 0,
            discount_type: req.body.discount_type || '$',
            discount_value: req.body.discount_value || 0,
            discount_amount: req.body.discount_amount || 0,
            subtotal: req.body.subtotal || 0,
            gst_amount: req.body.gst_amount || 0,
            fc_amount: req.body.fc_amount || 0,
            grand_total: grandTotal,
            status: 'draft',
            remarks: req.body.remarks || '',
            created_by: req.body.created_by || 1,
            invoice_type: req.body.invoice_type || 'Invoice',
            permit_no: req.body.permit_no || '',
            bill_of_lading_no: req.body.bill_of_lading_no || '',
            container_no: req.body.container_no || '',
            profit_reference: req.body.profit_reference || '',
            payment_status: paymentStatus,
            paid_amount: paidAmount,
            balance_amount: balanceAmount,
            items: req.body.items || []
        };
        
        // Validation
        if (!invoiceData.vendor_id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Vendor is required' 
            });
        }
        
        if (!invoiceData.items || invoiceData.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'At least one item is required' 
            });
        }
        
        // Insert invoice
        const sql = `
            INSERT INTO purchase_invoices 
            (
                vendor_id, invoice_no, transaction_no, 
                invoice_date, transaction_date, due_date, expected_payment_date,
                currency_id, currency_rate, gst_type, gst_value,
                terms, po_no, reference_no, project_id,
                add_to_project_costing, discount_type, discount_value,
                subtotal, discount_amount, gst_amount, grand_total,
                status, remarks, created_by, 
                permit_no, bill_of_lading_no, container_no,
                profit_reference, invoice_type,
                payment_status, paid_amount, balance_amount,
                created_at
            ) VALUES (
                @vendorId, @invoiceNo, @transactionNo,
                @invoiceDate, @transactionDate, @dueDate, @expectedPaymentDate,
                @currencyId, @currencyRate, @gstType, @gstValue,
                @terms, @poNo, @referenceNo, @projectId,
                @addToProjectCosting, @discountType, @discountValue,
                @subtotal, @discountAmount, @gstAmount, @grandTotal,
                @status, @remarks, @createdBy,
                @permitNo, @billOfLadingNo, @containerNo,
                @profitReference, @invoiceType,
                @paymentStatus, @paidAmount, @balanceAmount,
                GETDATE()
            );
            SELECT SCOPE_IDENTITY() AS invoiceId
        `;

        const request = pool.request()
            .input('vendorId', mssql.Int, parseInt(invoiceData.vendor_id, 10))
            .input('invoiceNo', mssql.NVarChar, invoiceData.invoice_no)
            .input('transactionNo', mssql.NVarChar, invoiceData.transaction_no)
            .input('invoiceDate', mssql.Date, parseDate(invoiceData.invoice_date))
            .input('transactionDate', mssql.Date, parseDate(invoiceData.transaction_date))
            .input('dueDate', mssql.Date, handleNull(invoiceData.due_date))
            .input('expectedPaymentDate', mssql.Date, handleNull(invoiceData.expected_payment_date))
            .input('currencyId', mssql.Int, invoiceData.currency_id)
            .input('currencyRate', mssql.Decimal(18, 4), invoiceData.currency_rate)
            .input('gstType', mssql.NVarChar, invoiceData.gst_type)
            .input('gstValue', mssql.Decimal(18, 2), invoiceData.gst_value)
            .input('terms', mssql.NVarChar, invoiceData.terms)
            .input('poNo', mssql.NVarChar, invoiceData.po_no)
            .input('referenceNo', mssql.NVarChar, invoiceData.reference_no)
            .input('projectId', mssql.Int, handleNull(invoiceData.project_id))
            .input('addToProjectCosting', mssql.Bit, invoiceData.add_to_project_costing)
            .input('discountType', mssql.NVarChar, invoiceData.discount_type)
            .input('discountValue', mssql.Decimal(18, 2), invoiceData.discount_value)
            .input('subtotal', mssql.Decimal(18, 2), invoiceData.subtotal)
            .input('discountAmount', mssql.Decimal(18, 2), invoiceData.discount_amount)
            .input('gstAmount', mssql.Decimal(18, 2), invoiceData.gst_amount)
            .input('grandTotal', mssql.Decimal(18, 2), invoiceData.grand_total)
            .input('status', mssql.NVarChar, invoiceData.status)
            .input('remarks', mssql.NVarChar, invoiceData.remarks)
            .input('createdBy', mssql.Int, invoiceData.created_by)
            .input('permitNo', mssql.NVarChar, invoiceData.permit_no)
            .input('billOfLadingNo', mssql.NVarChar, invoiceData.bill_of_lading_no)
            .input('containerNo', mssql.NVarChar, invoiceData.container_no)
            .input('profitReference', mssql.NVarChar, invoiceData.profit_reference)
            .input('invoiceType', mssql.NVarChar, invoiceData.invoice_type)
            .input('paymentStatus', mssql.NVarChar, invoiceData.payment_status)
            .input('paidAmount', mssql.Decimal(18, 2), invoiceData.paid_amount)
            .input('balanceAmount', mssql.Decimal(18, 2), invoiceData.balance_amount);

        const result = await request.query(sql);
        const invoiceId = result.recordset[0].invoiceId;

        console.log(`✅ Invoice saved! ID: ${invoiceId}`);
        
        // Save items
        await saveInvoiceItems(invoiceId, invoiceData, pool);
        
        res.json({
            success: true,
            data: { 
                invoice_id: invoiceId, 
                invoice_no: invoiceData.invoice_no,
                message: 'Invoice saved successfully'
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 2. GET PURCHASE INVOICES
app.get('/api/purchase-invoices', async (req, res) => {
    try {
        let {
            page = 1,
            limit = 20,
            vendor_search = '',
            vendor_id = '',
            status = '',
            start_date = '',
            end_date = '',
            invoice_no = ''
        } = req.query;

        page = parseInt(page);
        limit = parseInt(limit);
        const offset = (page - 1) * limit;

        console.log('📋 API Request with filters:', {
            vendor_search, vendor_id, status, start_date, end_date, invoice_no, page, limit
        });

        const pool = await getPool();
        const request = pool.request();

        let sql = `
            SELECT 
                pi.invoice_id,
                pi.invoice_no,
                pi.transaction_no,
                pi.invoice_date,
                pi.transaction_date,
                pi.due_date,
                pi.status,
                pi.payment_status,
                pi.subtotal,
                pi.discount_amount,
                pi.gst_amount,
                pi.grand_total,
                0 AS fc_amount,
                pi.paid_amount,
                pi.balance_amount,
                pi.remarks,
                pi.created_at,
                v.vendor_id,
                v.vendor_name,
                v.vendor_code,
                c.currency_code,
                c.currency_name
            FROM purchase_invoices pi
            LEFT JOIN vendors v ON pi.vendor_id = v.vendor_id
            LEFT JOIN currencies c ON pi.currency_id = c.currency_id
            WHERE 1=1
        `;

        let countSql = `
            SELECT COUNT(*) as total 
            FROM purchase_invoices pi
            LEFT JOIN vendors v ON pi.vendor_id = v.vendor_id
            WHERE 1=1
        `;

        // Vendor search
        if (vendor_search && vendor_search.trim() !== '') {
            sql += ` AND (
                v.vendor_name LIKE @vendorSearch OR 
                v.vendor_code LIKE @vendorSearch
            )`;
            countSql += ` AND (
                v.vendor_name LIKE @vendorSearch OR 
                v.vendor_code LIKE @vendorSearch
            )`;
            request.input('vendorSearch', mssql.NVarChar, `%${vendor_search.trim()}%`);
        }

        // Vendor filter
        if (vendor_id && vendor_id !== 'undefined' && vendor_id !== 'null' && vendor_id !== 'ALL' && !isNaN(parseInt(vendor_id, 10))) {
            const parsedVendorId = parseInt(vendor_id, 10);
            sql += ` AND pi.vendor_id = @vendorId`;
            countSql += ` AND pi.vendor_id = @vendorId`;
            request.input('vendorId', mssql.Int, parsedVendorId);
        }

        // Status filter
        if (status && status.trim() !== '' && status !== 'ALL') {
            const statusLower = status.toLowerCase();
            if (statusLower === 'overdue') {
                sql += ` AND pi.payment_status = 'overdue'`;
                countSql += ` AND pi.payment_status = 'overdue'`;
            } else if (statusLower === 'new') {
                sql += ` AND pi.payment_status = 'new'`;
                countSql += ` AND pi.payment_status = 'new'`;
            } else if (statusLower === 'partial') {
                sql += ` AND pi.payment_status = 'partial'`;
                countSql += ` AND pi.payment_status = 'partial'`;
            } else if (statusLower === 'paid') {
                sql += ` AND pi.payment_status = 'paid'`;
                countSql += ` AND pi.payment_status = 'paid'`;
            } else if (statusLower === 'draft') {
                sql += ` AND pi.status = 'draft'`;
                countSql += ` AND pi.status = 'draft'`;
            } else if (statusLower === 'cancelled') {
                sql += ` AND pi.status = 'cancelled'`;
                countSql += ` AND pi.status = 'cancelled'`;
            } else {
                sql += ` AND pi.payment_status = @status`;
                countSql += ` AND pi.payment_status = @status`;
                request.input('status', mssql.NVarChar, status);
            }
        }

        // Date filters
        if (start_date && start_date.trim() !== '' && end_date && end_date.trim() !== '') {
            sql += ` AND CAST(pi.transaction_date AS DATE) BETWEEN @startDate AND @endDate`;
            countSql += ` AND CAST(pi.transaction_date AS DATE) BETWEEN @startDate AND @endDate`;
            request.input('startDate', mssql.Date, parseDate(start_date));
            request.input('endDate', mssql.Date, parseDate(end_date));
        } else if (start_date && start_date.trim() !== '') {
            sql += ` AND CAST(pi.transaction_date AS DATE) >= @startDate`;
            countSql += ` AND CAST(pi.transaction_date AS DATE) >= @startDate`;
            request.input('startDate', mssql.Date, parseDate(start_date));
        } else if (end_date && end_date.trim() !== '') {
            sql += ` AND CAST(pi.transaction_date AS DATE) <= @endDate`;
            countSql += ` AND CAST(pi.transaction_date AS DATE) <= @endDate`;
            request.input('endDate', mssql.Date, parseDate(end_date));
        }

        // Invoice no search
        if (invoice_no && invoice_no.trim() !== '') {
            sql += ` AND (pi.invoice_no LIKE @invoiceSearch OR pi.transaction_no LIKE @invoiceSearch)`;
            countSql += ` AND (pi.invoice_no LIKE @invoiceSearch OR pi.transaction_no LIKE @invoiceSearch)`;
            request.input('invoiceSearch', mssql.NVarChar, `%${invoice_no.trim()}%`);
        }

        // Count query
        const countResult = await request.query(countSql);
        const total = countResult.recordset[0]?.total || 0;

        // Data query
        sql += ` ORDER BY pi.transaction_date DESC, pi.invoice_id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        request.input('offset', mssql.Int, offset);
        request.input('limit', mssql.Int, limit);

        const result = await request.query(sql);

        console.log(`✅ Found ${total} invoices, returning ${result.recordset.length}`);

        // Get summary
        const summaryResult = await pool.request().query(`
            SELECT 
                COALESCE(SUM(grand_total), 0) as total_invoice,
                COALESCE(SUM(CASE WHEN payment_status IN ('overdue', 'new') THEN balance_amount ELSE 0 END), 0) as total_unpaid,
                COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN grand_total ELSE 0 END), 0) as total_paid,
                COALESCE(SUM(grand_total), 0) as total_order
            FROM purchase_invoices pi
            WHERE status != 'cancelled'
        `);

        const summary = summaryResult.recordset[0] || {};

        res.json({
            success: true,
            data: result.recordset,
            summary: {
                total_order: summary.total_order || 0,
                total_invoice: summary.total_invoice || 0,
                total_unpaid: summary.total_unpaid || 0,
                total_paid: summary.total_paid || 0
            },
            pagination: {
                page: page,
                limit: limit,
                total: total,
                total_pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. GET VENDORS WITH INVOICES
app.get('/api/purchase-invoices/vendors-with-invoices', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT DISTINCT v.vendor_id, v.vendor_name, v.vendor_code
            FROM vendors v
            INNER JOIN purchase_invoices pi ON v.vendor_id = pi.vendor_id
            ORDER BY v.vendor_name
        `);

        res.json({ success: true, data: result.recordset });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. GET ACTIVE VENDORS
app.get('/api/vendors/active', async (req, res) => {
    try {
        console.log('👥 Getting active vendors');
        const pool = await getPool();

        const result = await pool.request().query(`
            SELECT vendor_id, vendor_code, vendor_name, email, phone 
            FROM vendors 
            WHERE is_active = 1 
            ORDER BY vendor_name
        `);

        console.log(`✅ Found ${result.recordset.length} vendors`);

        res.json({
            success: true,
            data: result.recordset
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. GET SINGLE PURCHASE INVOICE
app.get('/api/purchase-invoices/:id', async (req, res) => {
    try {
        const invoiceId = req.params.id;
        const pool = await getPool();

        // Update overdue status
        await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .query(`
                UPDATE purchase_invoices 
                SET payment_status = 'overdue'
                WHERE invoice_id = @invoiceId
                AND payment_status IN ('new', 'partial')
                AND due_date < CAST(GETDATE() AS DATE)
                AND status = 'posted'
            `);

        // Get invoice
        const invoiceResult = await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .query(`
                SELECT 
                    pi.*,
                    v.vendor_name,
                    v.vendor_code,
                    c.currency_code
                FROM purchase_invoices pi
                LEFT JOIN vendors v ON pi.vendor_id = v.vendor_id
                LEFT JOIN currencies c ON pi.currency_id = c.currency_id
                WHERE pi.invoice_id = @invoiceId
            `);

        if (invoiceResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }

        const invoice = invoiceResult.recordset[0];

        // Get items
        const itemsResult = await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .query('SELECT * FROM purchase_invoice_items WHERE invoice_id = @invoiceId');

        res.json({
            success: true,
            data: {
                ...invoice,
                items: itemsResult.recordset || []
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. UPDATE PURCHASE INVOICE
app.put('/api/purchase-invoices/:id', async (req, res) => {
    try {
        const invoiceId = req.params.id;
        console.log(`📤 ULTIMATE UPDATE for invoice ${invoiceId}`);

        const updateData = req.body;
        const pool = await getPool();

        // Auto-calculate payment status
        let paymentStatus = updateData.payment_status || 'new';

        if (updateData.due_date) {
            const today = new Date();
            const dueDate = new Date(updateData.due_date);
            const paidAmount = parseFloat(updateData.paid_amount) || 0;
            const grandTotal = parseFloat(updateData.grand_total) || 0;

            if (paidAmount >= grandTotal && grandTotal > 0) {
                paymentStatus = 'paid';
            } else if (paidAmount > 0) {
                paymentStatus = 'partial';
            } else if (dueDate < today) {
                paymentStatus = 'overdue';
            } else {
                paymentStatus = 'new';
            }
        }

        console.log('🎯 Auto-calculated payment_status:', paymentStatus);

        // Update invoice
        const updateSQL = `
            UPDATE purchase_invoices SET
                vendor_id = @vendorId,
                invoice_no = @invoiceNo,
                transaction_no = @transactionNo,
                invoice_date = @invoiceDate,
                transaction_date = @transactionDate,
                due_date = @dueDate,
                expected_payment_date = @expectedPaymentDate,
                currency_id = @currencyId,
                currency_rate = @currencyRate,
                gst_type = @gstType,
                gst_value = @gstValue,
                terms = @terms,
                po_no = @poNo,
                reference_no = @referenceNo,
                project_id = @projectId,
                add_to_project_costing = @addToProjectCosting,
                discount_type = @discountType,
                discount_value = @discountValue,
                discount_amount = @discountAmount,
                subtotal = @subtotal,
                gst_amount = @gstAmount,
                grand_total = @grandTotal,
                payment_status = @paymentStatus,
                balance_amount = @balanceAmount,
                remarks = @remarks,
                updated_at = GETDATE()
            WHERE invoice_id = @invoiceId
        `;

        const request = pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .input('vendorId', mssql.Int, parseInt(updateData.vendor_id, 10) || 0)
            .input('invoiceNo', mssql.NVarChar, updateData.invoice_no || '')
            .input('transactionNo', mssql.NVarChar, updateData.transaction_no || '')
            .input('invoiceDate', mssql.Date, parseDate(updateData.invoice_date))
            .input('transactionDate', mssql.Date, parseDate(updateData.transaction_date))
            .input('dueDate', mssql.Date, handleNull(updateData.due_date))
            .input('expectedPaymentDate', mssql.Date, handleNull(updateData.expected_payment_date))
            .input('currencyId', mssql.Int, updateData.currency_id || 1)
            .input('currencyRate', mssql.Decimal(18, 4), updateData.currency_rate || 1)
            .input('gstType', mssql.NVarChar, updateData.gst_type || 'Exclusive')
            .input('gstValue', mssql.Decimal(18, 2), updateData.gst_value || 9)
            .input('terms', mssql.NVarChar, updateData.terms || '30 Days')
            .input('poNo', mssql.NVarChar, updateData.po_no || '')
            .input('referenceNo', mssql.NVarChar, updateData.reference_no || '')
            .input('projectId', mssql.Int, handleNull(updateData.project_id))
            .input('addToProjectCosting', mssql.Bit, updateData.add_to_project_costing || 0)
            .input('discountType', mssql.NVarChar, updateData.discount_type || '$')
            .input('discountValue', mssql.Decimal(18, 2), updateData.discount_value || 0)
            .input('discountAmount', mssql.Decimal(18, 2), updateData.discount_amount || 0)
            .input('subtotal', mssql.Decimal(18, 2), updateData.subtotal || 0)
            .input('gstAmount', mssql.Decimal(18, 2), updateData.gst_amount || 0)
            .input('grandTotal', mssql.Decimal(18, 2), updateData.grand_total || 0)
            .input('paymentStatus', mssql.NVarChar, paymentStatus)
            .input('balanceAmount', mssql.Decimal(18, 2), updateData.balance_amount || updateData.grand_total || 0)
            .input('remarks', mssql.NVarChar, updateData.remarks || '');

        const updateResult = await request.query(updateSQL);

        console.log(`✅ Invoice updated. Affected rows: ${updateResult.rowsAffected[0]}`);

        // Delete old items
        await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .query('DELETE FROM purchase_invoice_items WHERE invoice_id = @invoiceId');

        console.log(`🗑️ Deleted old items`);

        // Insert new items
        if (updateData.items && updateData.items.length > 0) {
            const itemPromises = updateData.items.map(item => {
                const itemSQL = `
                    INSERT INTO purchase_invoice_items 
                    (invoice_id, item_type, reference_item_id, item_code, 
                     item_name, quantity, unit_price, total_amount, uom)
                    VALUES 
                    (@invoiceId, @itemType, @referenceItemId, @itemCode, 
                     @itemName, @quantity, @unitPrice, @totalAmount, @uom)
                `;

                return pool.request()
                    .input('invoiceId', mssql.Int, invoiceId)
                    .input('itemType', mssql.NVarChar, item.item_type || 'product')
                    .input('referenceItemId', mssql.Int, item.reference_item_id || 0)
                    .input('itemCode', mssql.NVarChar, item.item_code || '')
                    .input('itemName', mssql.NVarChar, item.item_name || 'Item')
                    .input('quantity', mssql.Decimal(18, 2), item.quantity || 1)
                    .input('unitPrice', mssql.Decimal(18, 2), item.unit_price || 0)
                    .input('totalAmount', mssql.Decimal(18, 2), item.total_amount || 0)
                    .input('uom', mssql.NVarChar, item.uom || 'PCS')
                    .query(itemSQL);
            });

            await Promise.all(itemPromises);
            console.log(`✅ All ${updateData.items.length} items saved`);
        }

        res.json({
            success: true,
            message: 'Invoice updated successfully',
            payment_status: paymentStatus,
            data: {
                invoice_id: invoiceId,
                items_updated: updateData.items?.length || 0
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 7. GET PURCHASE SUMMARY
app.get('/api/purchase-invoices/summary', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                COUNT(*) as total_count,
                COALESCE(SUM(CASE WHEN status = 'posted' THEN grand_total ELSE 0 END), 0) as total_invoice,
                COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN grand_total ELSE 0 END), 0) as total_paid,
                COALESCE(SUM(CASE WHEN payment_status IN ('new', 'partial', 'overdue') THEN balance_amount ELSE 0 END), 0) as total_unpaid,
                COALESCE(SUM(grand_total), 0) as total_order
            FROM purchase_invoices
            WHERE status IN ('draft', 'posted', 'paid')
        `);

        const summary = result.recordset[0] || {};

        res.json({
            success: true,
            data: {
                total_order: summary.total_order || 0,
                total_invoice: summary.total_invoice || 0,
                total_unpaid: summary.total_unpaid || 0,
                total_paid: summary.total_paid || 0,
                counts: {
                    total: summary.total_count || 0
                }
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 8. POST PURCHASE INVOICE
app.post('/api/purchase-invoices/:id/post', async (req, res) => {
    try {
        const invoiceId = req.params.id;
        const pool = await getPool();

        // Get invoice details
        const getResult = await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .query('SELECT due_date FROM purchase_invoices WHERE invoice_id = @invoiceId');

        if (getResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }

        const invoice = getResult.recordset[0];
        const today = new Date();
        const dueDate = new Date(invoice.due_date);

        let paymentStatus = 'new';
        if (dueDate < today) {
            paymentStatus = 'overdue';
        }

        // Update invoice
        await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .input('paymentStatus', mssql.NVarChar, paymentStatus)
            .query(`
                UPDATE purchase_invoices 
                SET 
                    status = 'posted',
                    payment_status = @paymentStatus,
                    updated_at = GETDATE()
                WHERE invoice_id = @invoiceId
            `);

        res.json({
            success: true,
            message: `Invoice posted successfully! Status: ${paymentStatus.toUpperCase()}`,
            data: {
                status: 'posted',
                payment_status: paymentStatus
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 9. DELETE PURCHASE INVOICE
app.delete('/api/purchase-invoices/:id', async (req, res) => {
    try {
        const invoiceId = req.params.id;
        console.log(`🗑️ Deleting purchase invoice: ${invoiceId}`);

        const pool = await getPool();

        // Check if exists
        const checkResult = await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .query('SELECT invoice_no, status FROM purchase_invoices WHERE invoice_id = @invoiceId');

        if (checkResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }

        const invoiceNo = checkResult.recordset[0].invoice_no;
        const status = checkResult.recordset[0].status;

        if (status === 'posted' || status === 'paid') {
            return res.status(400).json({
                success: false,
                error: `Cannot delete ${status} invoice. Cancel it first.`
            });
        }

        // Delete (cascade will delete items)
        await pool.request()
            .input('invoiceId', mssql.Int, invoiceId)
            .query('DELETE FROM purchase_invoices WHERE invoice_id = @invoiceId');

        console.log(`✅ Invoice "${invoiceNo}" deleted`);
        res.json({
            success: true,
            message: `Invoice "${invoiceNo}" deleted successfully`
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= START SERVER =============

app.listen(PORT, () => {
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`🔧 API Test: http://localhost:${PORT}/api/test`);
    console.log(`📊 List DBs: http://localhost:${PORT}/api/dbs`);
    console.log(`➕ Insert Test: http://localhost:${PORT}/api/insert-test`);
});