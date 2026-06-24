require('dotenv').config();
const express = require('express');
const mysql = require('mysql2'); // ✅ Keep as mysql2
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/js', express.static(path.join(__dirname, '../frontend/js')));
app.use(express.json({ limit: '10mb' })); // Increase from default 100kb
app.use(express.urlencoded({ limit: '10mb', extended: true }));
// Database connection TEST

const db = mysql.createConnection({
    host: process.env.DB_HOST || 'database-1.ct2s4oesuriu.ap-southeast-2.rds.amazonaws.com',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'uniprosg1500',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'unipro_erp',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 60000,
    acquireTimeout: 60000,
    timeout: 60000
});
const dbPromise = db.promise();

// Test database connection

db.connect((err) => {
    if (err) {
        console.error('❌ Database connection FAILED:', err.message);
    } else {
        console.log('✅ RDS MySQL Connection SUCCESSFUL!');

        // Just test - show databases
        db.query('SHOW DATABASES', (err, results) => {
            if (err) {
                console.error('Error showing databases:', err.message);
            } else {
                console.log('📊 Available databases:');
                results.forEach(row => console.log('  -', row.Database));
            }
        });
    }

});

cron.schedule('0 0 * * *', () => {
    console.log('🔄 Checking overdue invoices...');
    
    const sql = `
        UPDATE purchase_invoices 
        SET payment_status = 'overdue'
        WHERE payment_status IN ('new', 'partial')
        AND due_date < CURDATE()
        AND status = 'posted'
    `;
    
    db.query(sql, (err, result) => {
        if (err) {
            console.error('❌ Overdue update error:', err);
        } else if (result.affectedRows > 0) {
            console.log(`✅ Updated ${result.affectedRows} invoices to overdue`);
        }
    });
});



const pool = mysql.createPool({
    host: process.env.DB_HOST || 'database-1.ct2s4oesuriu.ap-southeast-2.rds.amazonaws.com',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'uniprosg1500',
    database: process.env.DB_NAME || 'unipro_erp',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true
});

   


// Initial creation


// Pool error handling
pool.on('error', (err) => {
    console.error('❌ Pool error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Recreating connection pool...');
        createConnectionPool();
    }
});
const poolPromise = pool.promise();
// ============= SIMPLE TEST API =============
// Test API endpoint
app.get('/api/test', (req, res) => {
    res.json({
        status: 'success',
        message: 'UniPro Backend is running!',
        database: 'RDS MySQL Connected',
        timestamp: new Date().toISOString(),
        endpoints: [
            '/api/test',
            '/api/dbs',
            '/api/query'
        ]
    });
});
// List databases
app.get('/api/dbs', (req, res) => {
    db.query('SHOW DATABASES', (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({
                count: results.length,
                databases: results.map(row => row.Database)
            });
        }
    });
});
// Run custom query
app.get('/api/query', (req, res) => {
    const query = req.query.q || 'SELECT 1+1 AS result';

    db.query(query, (err, results) => {
        if (err) {
            res.status(500).json({
                error: err.message,
                query: query
            });
        } else {
            res.json({
                query: query,
                results: results,
                count: results.length
            });
        }
    });
});
// Simple insert test
app.get('/api/insert-test', (req, res) => {
    // Create test database if not exists
    db.query('CREATE DATABASE IF NOT EXISTS test_db', (err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // Use test database
        db.changeUser({ database: 'test_db' }, (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // Create test table
            const createTable = `
        CREATE TABLE IF NOT EXISTS test_table (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

            db.query(createTable, (err) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                // Insert test data
                const insertData = 'INSERT INTO test_table (name) VALUES (?)';
                db.query(insertData, ['Test User ' + Date.now()], (err, result) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }

                    // Select all data
                    db.query('SELECT * FROM test_table', (err, rows) => {
                        if (err) {
                            return res.status(500).json({ error: err.message });
                        }

                        res.json({
                            message: 'Test successful!',
                            insertedId: result.insertId,
                            totalRecords: rows.length,
                            data: rows
                        });
                    });
                });
            });
        });
    });
});
// ============= FRONTEND ROUTES =============
// Serve HTML files
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

// ============= CUSTOMER MANAGEMENT APIs =============
// 1. CREATE CUSTOMER
// 1. CREATE CUSTOMER - Modified for text inputs
app.post('/api/customers', (req, res) => {
    try {
        const customerData = req.body;
        console.log('🔧 Creating customer with new address fields...');
        console.log('Delivery address data:', {
            is_delivery_same_address: customerData.is_delivery_same_address,
            delivery_address1: customerData.delivery_address1,
            delivery_city: customerData.delivery_city,
            delivery_country: customerData.delivery_country
        });
        console.log('🔧 Creating customer:', customerData.customer_code);

        // Required validation
        if (!customerData.customer_code || !customerData.customer_name) {
            return res.status(400).json({
                success: false,
                error: 'Customer code and name are required'
            });
        }

        // Check duplicate customer code
        const checkSql = 'SELECT customer_id FROM customers WHERE customer_code = ?';

        db.query(checkSql, [customerData.customer_code], (checkErr, checkResult) => {
            if (checkErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
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
                alias: customerData.alias || null,
                company_reg_no: customerData.company_reg_no || null,
                gst_reg: customerData.gst_reg || null,
                gst_type: customerData.gst_type || 'Exclusive',

                // Salesman as TEXT input (not ID)
                salesman: salesmanName, // 👈 TEXT FIELD

                // Other fields...
                is_active: customerData.is_active !== undefined ? customerData.is_active : true,
                currency: customerData.currency || 'SGD',
                credit_limit: parseFloat(customerData.credit_limit) || 0.00,
                is_hq_customer: customerData.is_hq_customer || false,
                is_blocked: customerData.is_blocked || false,
                credit_terms: customerData.credit_terms || '7 Days',
                tolerance: customerData.tolerance || '7 Days',
                bank_id: req.body.bank_id || null,
                bank_name: customerData.bank_name || null,
                bank_account_no: customerData.bank_account_no || null,
                website: customerData.website || null,
                rate_type: customerData.rate_type || null,
                ar_account_id: req.body.ar_account_id || null,
                hq_reference: customerData.hq_reference || null,
                schedule_day: customerData.schedule_day || 'Monday',
                address_line1: customerData.address_line1 || null,
                address_line2: customerData.address_line2 || null,
                address_line3: customerData.address_line3 || null,
                city: customerData.city || 'Singapore',
                postal_code: customerData.postal_code || null,
                country: customerData.country || 'Singapore',
                is_delivery_same_address: customerData.is_delivery_same_address || false,
                delivery_address: customerData.delivery_address1 || null,
                delivery_address1: customerData.delivery_address1 || null,
                delivery_address2: customerData.delivery_address2 || null,
                delivery_address3: customerData.delivery_address3 || null,
                delivery_city: customerData.delivery_city || null,
                delivery_country: customerData.delivery_country || null,
                delivery_postal_code: customerData.delivery_postal_code || null,
                contact_person1: customerData.contact_person1 || null,
                phone1: customerData.phone1 || null,
                email: customerData.email || null,
                office_phone: customerData.office_phone || null,
                fax_number: customerData.fax_number || null,
                contact_no: customerData.contact_no || null,
                customer_remarks: customerData.customer_remarks || null,
                customer_note: customerData.customer_note || null,

                // Audit fields
                created_by: 1, // From session
                created_at: new Date()
            };
            if (insertData.is_delivery_same_address) {
                insertData.delivery_address1 = insertData.address_line1;
                insertData.delivery_address2 = insertData.address_line2;
                insertData.delivery_address3 = insertData.address_line3;
                insertData.delivery_city = insertData.city;
                insertData.delivery_country = insertData.country;
                insertData.delivery_postal_code = insertData.postal_code;
            }

            console.log('📝 Final data for DB insert:', insertData);
            // Insert customer
            const insertSql = 'INSERT INTO customers SET ?';

            db.query(insertSql, insertData, (err, result) => {
                if (err) {
                    console.error('❌ Customer create error:', err);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create customer: ' + err.message
                    });
                }

                console.log(`✅ Customer created: ${customerData.customer_code} (ID: ${result.insertId})`);

                // Return success response
                res.status(201).json({
                    success: true,
                    message: 'Customer created successfully',
                    customer_id: result.insertId,
                    customer_code: customerData.customer_code
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// 2. READ ALL CUSTOMERS (with search/filter) - FOR BACKEND USERS
app.get('/api/customers', (req, res) => {
    const {
        search,
        page = 1,
        limit = 20,
        status,
        salesman // 👈 Now search by salesman TEXT
    } = req.query;

    const offset = (page - 1) * limit;

    // Simple query - no JOIN with salesmen table
    let sql = `
        SELECT 
            c.*,
            u.username as created_by_name
        FROM customers c
        LEFT JOIN users u ON c.created_by = u.user_id
        WHERE 1=1
    `;

    const params = [];

    // Search filter
    if (search) {
        sql += ` AND (
            c.customer_code LIKE ? OR 
            c.customer_name LIKE ? OR 
            c.email LIKE ? OR 
            c.contact_person1 LIKE ? OR
            c.salesman LIKE ?  -- 👈 Search by salesman text
        )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND c.is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND c.is_active = FALSE';
    } else if (status === 'blocked') {
        sql += ' AND c.is_blocked = TRUE';
    }

    // Salesman filter (by text)
    if (salesman && salesman !== 'all') {
        sql += ' AND c.salesman LIKE ?';
        params.push(`%${salesman}%`);
    }

    // Order and pagination
    sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    // Get total count
    const countSql = sql.replace(
        'SELECT c.*, u.username as created_by_name',
        'SELECT COUNT(*) as total'
    ).replace('ORDER BY c.created_at DESC LIMIT ? OFFSET ?', '');

    db.query(countSql, params.slice(0, -2), (err, countResult) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        db.query(sql, params, (err, results) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult[0]?.total || 0,
                    totalPages: Math.ceil((countResult[0]?.total || 0) / limit)
                }
            });
        });
    });
});

// 3. CUSTOMER LIST API - FOR FRONTEND TABLE (WITH FORMATTED DATA)
app.get('/api/customers/list', (req, res) => {
    const {
        page = 1,
        limit = 10,
        search = '',
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;

    let sql = `
    SELECT 
      c.customer_id,
      c.customer_code,
      c.customer_name,
      c.currency,
      c.credit_limit,
      COALESCE(c.credit_on_hold, 0) as credit_on_hold,
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

    const params = [];

    // Search filter
    if (search) {
        sql += ` AND (
      c.customer_code LIKE ? OR 
      c.customer_name LIKE ? OR 
      c.contact_person1 LIKE ? OR 
      c.phone1 LIKE ? OR
      c.email LIKE ?
    )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND c.is_active = TRUE AND c.is_blocked = FALSE';
    } else if (status === 'inactive') {
        sql += ' AND c.is_active = FALSE';
    } else if (status === 'blocked') {
        sql += ' AND c.is_blocked = TRUE';
    }

    // Count query
    const countSql = sql.replace(
        'SELECT c.customer_id, c.customer_code, c.customer_name, c.currency, c.credit_limit, COALESCE(c.credit_on_hold, 0) as credit_on_hold, c.is_active, c.is_blocked, c.contact_person1, c.phone1, c.email, s.salesman_name, c.created_at',
        'SELECT COUNT(*) as total'
    );

    // Add ordering and pagination
    sql += ' ORDER BY c.customer_id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    // Execute count query
    db.query(countSql, params.slice(0, -2), (err, countResult) => {
        if (err) {
            console.error('❌ Count error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        // Execute data query
        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Data error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            // Format results for frontend table
            const formattedResults = results.map(customer => ({
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
                    total: countResult[0]?.total || 0,
                    totalPages: Math.ceil((countResult[0]?.total || 0) / limit)
                }
            });
        });
    });
});

// 4. CUSTOMER TABLE API (COMPLETE VERSION WITH ALL FEATURES)
app.get('/api/customers/table', (req, res) => {
    const {
        page = 1,
        limit = 20,
        search = '',
        status = 'all',
        salesman = 'all',
        currency = 'all',
        sortBy = 'customer_code',  // 👈 Default to code (not id)
        sortOrder = 'ASC'           // 👈 Default to ASC (0001, 0002 order)
    } = req.query;

    const offset = (page - 1) * limit;
    
    // Build WHERE conditions
    let whereConditions = 'WHERE 1=1';
    const params = [];

    // Search filter
    if (search && search.trim() !== '') {
        whereConditions += ` AND (
            c.customer_code LIKE ? OR 
            c.customer_name LIKE ? OR 
            c.contact_person1 LIKE ? OR 
            c.phone1 LIKE ? OR
            c.email LIKE ? OR
            c.salesman LIKE ?
        )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status !== 'all') {
        if (status === 'active') {
            whereConditions += ' AND c.is_active = TRUE AND c.is_blocked = FALSE';
        } else if (status === 'inactive') {
            whereConditions += ' AND c.is_active = FALSE';
        } else if (status === 'blocked') {
            whereConditions += ' AND c.is_blocked = TRUE';
        }
    }

    // Salesman filter
    if (salesman !== 'all') {
        whereConditions += ' AND c.salesman LIKE ?';
        params.push(`%${salesman}%`);
    }

    // Currency filter
    if (currency !== 'all') {
        whereConditions += ' AND c.currency = ?';
        params.push(currency);
    }

    // ORDER BY clause - FIXED
    let orderClause = 'ORDER BY ';

// Determine column
switch(sortBy) {
    case 'code':
        orderClause += 'CAST(c.customer_code AS UNSIGNED)';
        break;
    case 'name':
        orderClause += 'c.customer_name';
        break;
    case 'created_at':
        orderClause += 'c.created_at';
        break;
    case 'id':
    default:
        orderClause += 'c.customer_id';
}
    
    // Set sort order
   orderClause += ` ${sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}`;

    // Separate queries for clarity
    const countSql = `SELECT COUNT(*) as total FROM customers c ${whereConditions}`;
    
    // ✅ CORRECTED: Only one ORDER BY clause
  const dataSql = `
    SELECT 
        c.customer_id,
        c.customer_code,
        c.customer_name,
        c.currency,
        c.credit_limit,
        COALESCE(c.credit_on_hold, 0) as credit_on_hold,
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
            
            
            -- 🔥 ADD DELIVERY ADDRESS FIELDS - CRITICAL!
            c.is_delivery_same_address,
            c.delivery_address1,
            c.delivery_address2,
            c.delivery_address3,
            c.delivery_city,
            c.delivery_country,
            c.delivery_postal_code,
            
            -- 🔥 ADD BANK FIELDS
            c.bank_name,
            c.bank_account_no,
            -- 🔥 ADD GST FIELDS
            c.gst_type,
            c.gst_reg,
            
            -- 🔥 ADD CREDIT TERMS
            c.credit_terms,
            c.tolerance,
            
            -- 🔥 ADD COMPANY INFO
            c.company_reg_no,
            c.office_phone
    FROM customers c
    ${whereConditions}
    ${orderClause}
    LIMIT ? OFFSET ?
`;

    // For data query, add limit and offset
    const dataParams = [...params, parseInt(limit), parseInt(offset)];

    console.log('🔍 SQL Debug:');
    console.log('Order Clause:', orderClause);
    console.log('Full Data SQL:', dataSql);

    // Run count query
    db.query(countSql, params, (err, countResult) => {
        if (err) {
            console.error('Count error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        const total = Number(countResult[0]?.total) || 0;

        // Run data query
        db.query(dataSql, dataParams, (err, results) => {
            if (err) {
                console.error('Data error:', err);
                return res.status(500).json({ success: false, error: err.message });
            }

            // Debug: Show first few results order
            console.log('📊 First 5 results order:');
            results.slice(0, 5).forEach(cust => {
                console.log(`  ${cust.customer_code} - ${cust.customer_name}`);
            });

            res.json({
                success: true,
                data: results,
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
        });
    });
});
// 5. CUSTOMER STATISTICS API
app.get('/api/customers/stats', (req, res) => {
    const sql = `
    SELECT 
      COUNT(*) as total_customers,
      SUM(CASE WHEN is_active = TRUE AND is_blocked = FALSE THEN 1 ELSE 0 END) as active_customers,
      SUM(CASE WHEN is_active = FALSE THEN 1 ELSE 0 END) as inactive_customers,
      SUM(CASE WHEN is_blocked = TRUE THEN 1 ELSE 0 END) as blocked_customers,
      SUM(credit_limit) as total_credit_limit,
      SUM(COALESCE(credit_on_hold, 0)) as total_credit_on_hold
    FROM customers
  `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
        res.json({
            success: true,
            data: results[0] || {
                total_customers: 0,
                active_customers: 0,
                inactive_customers: 0,
                blocked_customers: 0,
                total_credit_limit: 0,
                total_credit_on_hold: 0
            }
        });
    });
});
// 6. READ SINGLE CUSTOMER
app.get('/api/customers/:id', (req, res) => {
    const customerId = req.params.id;

    console.log(`📄 Fetching customer ID: ${customerId}`);

    // Simple query - no salesman_id JOIN needed
    const sql = `
        SELECT 
            c.*,
            c.delivery_address1,  -- Explicitly select
            c.delivery_address2,
            c.delivery_address3,
            c.delivery_city,
            c.delivery_country,
            c.delivery_postal_code,
            u.username as created_by_name
        FROM customers c
        LEFT JOIN users u ON c.created_by = u.user_id
        WHERE c.customer_id = ?
    `;

    db.query(sql, [customerId], (err, results) => {
        if (err) {
            console.error('❌ Customer fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Customer not found'
            });
        }

        // Return customer data (salesman is already in text format)
        res.json({
            success: true,
            data: results[0]
        });
    });
});
// 7. UPDATE CUSTOMER
// PUT: /api/customers/:id - FIXED VERSION
app.put('/api/customers/:id', (req, res) => {
    const customerId = req.params.id;
    const updateData = req.body;

    console.log('📥 Received update for customer:', customerId);
    console.log('📊 Update data received:', JSON.stringify(updateData, null, 2));
    // Validation
    if (!updateData.customer_name) {
        return res.status(400).json({
            success: false,
            error: 'Customer name is required'
        });
    }
 const salesmanName = updateData.salesman?.trim() || null;
    // Prepare update data
    const finalUpdateData = {
        customer_name: updateData.customer_name,
        alias: updateData.alias || null,
        company_reg_no: updateData.company_reg_no || null,
        gst_reg: updateData.gst_reg || null,
        gst_type: updateData.gst_type || 'Exclusive',

        // Salesman as TEXT (not ID)
        salesman: salesmanName,// 👈 TEXT FIELD

        // Other fields...
        is_active: updateData.is_active !== undefined ? updateData.is_active : true,
        currency: updateData.currency || 'SGD',
        credit_limit: parseFloat(updateData.credit_limit) || 0.00,
        is_hq_customer: updateData.is_hq_customer || false,
        is_blocked: updateData.is_blocked || false,
        credit_terms: updateData.credit_terms || '30 Days',
        tolerance: updateData.tolerance || '7 Days',
        bank_id: updateData.bank_id || null,
        bank_name: updateData.bank_name || null,
        bank_account_no: updateData.bank_account_no || null,
        website: updateData.website || null,
        rate_type: updateData.rate_type || null,
        ar_account_id: updateData.ar_account_id || null,
        hq_reference: updateData.hq_reference || null,
        schedule_day: updateData.schedule_day || 'Monday',
        address_line1: updateData.address_line1 || null,
        address_line2: updateData.address_line2 || null,
        address_line3: updateData.address_line3 || null,
        city: updateData.city || 'Singapore',
        postal_code: updateData.postal_code || null,
        country: updateData.country || 'Singapore',
        is_delivery_same_address: updateData.is_delivery_same_address || false,
        delivery_address1: updateData.delivery_address1 || null,
        delivery_address2: updateData.delivery_address2 || null,
        delivery_address3: updateData.delivery_address3 || null,
        delivery_city: updateData.delivery_city || null,
        delivery_country: updateData.delivery_country || null,
        delivery_postal_code: updateData.delivery_postal_code || null,

        contact_person1: updateData.contact_person1 || null,
        phone1: updateData.phone1 || null,
        email: updateData.email || null,
        office_phone: updateData.office_phone || null,
        fax_number: updateData.fax_number || null,
        contact_no: updateData.contact_no || null,
        customer_remarks: updateData.customer_remarks || null,
        customer_note: updateData.customer_note || null,

        // Audit
        updated_by: 1,
        updated_at: new Date()
    };

    // Update query
    console.log('📝 Final data for DB update:', finalUpdateData);

    // Update query
    const updateSql = 'UPDATE customers SET ? WHERE customer_id = ?';

    db.query(updateSql, [finalUpdateData, customerId], (updateErr, updateResult) => {
        if (updateErr) {
            console.error('❌ Update error:', updateErr);
            return res.status(500).json({
                success: false,
                error: 'Failed to update customer: ' + updateErr.message,
                sqlError: updateErr
            });
        }
        console.log('✅ Update result:', updateResult);

        if (updateResult.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Customer not found'
            });
        }
        console.log(`✅ Customer ID: ${customerId} updated successfully`);

        // Fetch updated record to verify
        const verifySql = 'SELECT customer_id, currency, bank_id, ar_account_id, salesman FROM customers WHERE customer_id = ?';
        db.query(verifySql, [customerId], (verifyErr, verifyResult) => {
            if (!verifyErr && verifyResult.length > 0) {
                console.log('✅ VERIFIED UPDATE:', verifyResult[0]);
            }

            res.json({
                success: true,
                message: 'Customer updated successfully',
                customer_id: customerId,
                updated_fields: {
                    currency: finalUpdateData.currency,
                    bank_id: finalUpdateData.bank_id,
                    ar_account_id: finalUpdateData.ar_account_id,
                    salesman: finalUpdateData.salesman
                }
            });
        });
    });
});

// ============= SIMPLE REAL HARD DELETE =============
app.delete('/api/customers/:id', (req, res) => {
    const customerId = parseInt(req.params.id);
    console.log(`🔥 REAL DELETE for customer ${customerId}`);

    // STEP 1: Check if customer exists
    const checkSql = 'SELECT customer_id, customer_name, customer_code FROM customers WHERE customer_id = ?';

    db.query(checkSql, [customerId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + err.message
            });
        }

        if (results.length === 0) {
            return res.json({
                success: false,
                error: `Customer ID ${customerId} not found`
            });
        }

        const customer = results[0];
        console.log(`Deleting: ${customer.customer_name} (${customer.customer_code})`);

        // STEP 2: SIMPLE DELETE - NO TRANSACTION
        const deleteSql = 'DELETE FROM customers WHERE customer_id = ?';

        db.query(deleteSql, [customerId], (deleteErr, deleteResult) => {
            if (deleteErr) {
                console.error('❌ DELETE FAILED:', deleteErr);
                return res.status(500).json({
                    success: false,
                    error: deleteErr.message,
                    sqlCode: deleteErr.code
                });
            }

            console.log('✅ DELETE successful - Affected rows:', deleteResult.affectedRows);

            if (deleteResult.affectedRows === 0) {
                return res.json({
                    success: false,
                    error: 'No rows deleted - customer may not exist'
                });
            }

            // STEP 3: VERIFY deletion
            setTimeout(() => {
                db.query(checkSql, [customerId], (verifyErr, verifyResults) => {
                    if (verifyErr) {
                        console.error('Verification error:', verifyErr);
                    } else if (verifyResults.length > 0) {
                        console.error('🚨 VERIFICATION FAILED: Customer still exists!');
                    } else {
                        console.log('✅ Verified: Customer deleted from database');
                    }
                });
            }, 100);

            // STEP 4: SUCCESS RESPONSE
            res.json({
                success: true,
                message: `Customer "${customer.customer_name}" PERMANENTLY DELETED`,
                deletedId: customerId,
                deletedName: customer.customer_name,
                deletedCode: customer.customer_code,
                affectedRows: deleteResult.affectedRows,
                action: 'HARD_DELETE_COMPLETED',
                timestamp: new Date().toISOString()
            });
        });
    });
});
// 9. GET ALL SALESMEN (For filters)

// 11. CHECK CUSTOMER CODE AVAILABILITY
app.get('/api/customers/check-code/:code', (req, res) => {
    const customerCode = req.params.code;

    const sql = 'SELECT customer_id FROM customers WHERE customer_code = ?';

    db.query(sql, [customerCode], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json({
            success: true,
            available: results.length === 0,
            exists: results.length > 0
        });
    });
});
// 12. CUSTOMER TEST ENDPOINT (Simple)
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
            '/api/customers/:id - DELETE (soft delete)',
            '/api/salesmen/all - GET (all salesmen)',
            '/api/customers/check-code/:code - GET (check code)'
        ]
    });
});
app.get('/api/banks/active', (req, res) => {
    const sql = `
        SELECT 
            bank_id, 
            bank_code, 
            bank_name, 
            display_name,
            account_number,
            currency_id,
            c.currency_code
        FROM banks b
        LEFT JOIN currencies c ON b.currency_id = c.currency_id
        WHERE b.is_active = 1
        ORDER BY bank_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// 2. GET: Active currencies for dropdown
app.get('/api/currencies/active', (req, res) => {
    const sql = `
        SELECT 
            currency_id,
            currency_code,
            currency_name,
            currency_symbol,
            display_name
        FROM currencies
        WHERE is_active = 1
        ORDER BY currency_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});
///dddd
app.get('/api/salesmen/active', (req, res) => {
    const sql = `
        SELECT salesman_id, salesman_code, salesman_name, 
               email, phone, is_active
        FROM salesmen 
        WHERE is_active = 1
        ORDER BY salesman_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});

// 2. GET All Salesmen (for dropdown)
app.get('/api/salesmen/dropdown', (req, res) => {
    const sql = `
        SELECT 
            salesman_id as value,
            CONCAT(salesman_code, ' - ', salesman_name) as label,
            salesman_name,
            salesman_code
        FROM salesmen 
        WHERE is_active = 1
        ORDER BY salesman_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// 3. GET Active Currencies
app.get('/api/currencies/active', (req, res) => {
    const sql = `
        SELECT 
            currency_id,
            currency_code,
            currency_name,
            currency_symbol,
            display_name,
            exchange_rate,
            is_active
        FROM currencies
        WHERE is_active = 1
        ORDER BY currency_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});

// 2. Get ALL currencies (for create form)
app.get('/api/currencies/active', (req, res) => {
    const sql = `
        SELECT 
            currency_id,
            currency_code,
            currency_name,
            currency_symbol,
            display_name,
            is_active
        FROM currencies
        WHERE is_active = 1
        ORDER BY currency_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
app.get('/api/customers/salesmen-used', (req, res) => {
    const sql = `
        SELECT DISTINCT 
            c.salesman as salesman_name,
            COUNT(*) as customer_count
        FROM customers c
        WHERE c.salesman IS NOT NULL 
          AND c.salesman != ''
          AND TRIM(c.salesman) != ''
        GROUP BY c.salesman
        ORDER BY salesman_name
    `;
    
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});

// GET: Get all active salesmen (alternative)
app.get('/api/salesmen/active', (req, res) => {
    const sql = `
        SELECT 
            salesman_id,
            salesman_code,
            salesman_name,
            email,
            phone,
            is_active
        FROM salesmen 
        WHERE is_active = 1
        ORDER BY salesman_name
    `;
    
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
// IMPROVED SALESMEN LIST API
app.get('/api/customers/salesmen-list', (req, res) => {
    const sql = `
        SELECT 
    customer_id,
    customer_name,
    salesman,
    LENGTH(salesman) as length,
    TRIM(salesman) as trimmed
FROM customers 
WHERE salesman IS NOT NULL 
  AND salesman != ''
ORDER BY customer_id DESC;
    `;
    
    console.log('🔍 Fetching salesmen from database...');
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Salesmen query error:', err);
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        console.log('✅ Salesmen found:', results.length);
        console.log('📊 Salesmen data:', results);
        
        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
app.get('/api/customers/salesmen', (req, res) => {
    const sql = `
        SELECT DISTINCT 
            TRIM(salesman) as salesman_name,
            COUNT(*) as customer_count
        FROM customers 
        WHERE salesman IS NOT NULL 
          AND salesman != ''
          AND TRIM(salesman) != ''
        GROUP BY TRIM(salesman)
        ORDER BY salesman_name
    `;
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Salesmen fetch error:', err);
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        res.json({
            success: true,
            data: results
        });
    });
});
// ============= CUSTOMER PRICING APIs =============

// 1. CREATE CUSTOMER PRICING
app.post('/api/customer-pricing', (req, res) => {
    const pricingData = req.body;

    console.log('📦 Creating customer pricing:', pricingData);

    // Start transaction
    db.beginTransaction((err) => {
        if (err) {
            console.error('Transaction error:', err);
            return res.status(500).json({ error: err.message });
        }

        // 1. Insert pricing header
        const headerSql = `
            INSERT INTO customer_pricing_header SET ?
        `;

        const headerData = {
            customer_id: pricingData.customer_id,
            customer_code: pricingData.customer_code,
            customer_name: pricingData.customer_name,
            from_date: pricingData.from_date,
            to_date: pricingData.to_date,
            location: pricingData.location,
            status: 'Draft',
            department_name: pricingData.department_name || null,
            category_name: pricingData.category_name || null,
            brand_name: pricingData.brand_name || null,
            product_name: pricingData.product_name || null,
            created_by: 1 // From session
        };

        db.query(headerSql, headerData, (err, result) => {
            if (err) {
                db.rollback(() => {
                    console.error('Header insert error:', err);
                    res.status(500).json({ error: err.message });
                });
                return;
            }

            const pricingId = result.insertId;
            console.log('✅ Pricing header created, ID:', pricingId);

            // 2. Insert pricing details if products exist
            if (pricingData.products && pricingData.products.length > 0) {
                let detailErrors = [];
                let insertedCount = 0;

                pricingData.products.forEach((product, index) => {
                    const detailSql = `
                        INSERT INTO customer_pricing_details SET ?
                    `;

                    const detailData = {
                        pricing_id: pricingId,
                        product_id: product.product_id || null,
                        product_code: product.product_code || null,
                        product_name: product.product_name,
                        uom: product.uom || 'PCS',
                        list_price: product.list_price || 0.00,
                        dollar_price: product.dollar_price || 0.00,
                        customer_price: product.customer_price || 0.00
                    };

                    db.query(detailSql, detailData, (err, detailResult) => {
                        if (err) {
                            detailErrors.push({ product: product.product_name, error: err.message });
                        } else {
                            insertedCount++;
                        }

                        // Check if all details processed
                        if (index === pricingData.products.length - 1) {
                            if (detailErrors.length > 0) {
                                db.rollback(() => {
                                    console.error('Details insert errors:', detailErrors);
                                    res.status(500).json({
                                        error: 'Some products failed to save',
                                        details: detailErrors
                                    });
                                });
                            } else {
                                // Commit transaction
                                db.commit((err) => {
                                    if (err) {
                                        db.rollback(() => {
                                            console.error('Commit error:', err);
                                            res.status(500).json({ error: err.message });
                                        });
                                        return;
                                    }

                                    console.log(`✅ Pricing created successfully! ID: ${pricingId}, Products: ${insertedCount}`);

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
                                });
                            }
                        }
                    });
                });
            } else {
                // No products, just commit
                db.commit((err) => {
                    if (err) {
                        db.rollback(() => {
                            console.error('Commit error:', err);
                            res.status(500).json({ error: err.message });
                        });
                        return;
                    }

                    res.status(201).json({
                        success: true,
                        message: 'Customer pricing created (no products added)',
                        pricing_id: pricingId,
                        products_count: 0
                    });
                });
            }
        });
    });
});

// 2. GET ALL CUSTOMER PRICING
app.get('/api/customer-pricing', (req, res) => {
    const {
        page = 1,
        limit = 10,
        search = '',
        status = '',
        customer_id = ''
    } = req.query;

    const offset = (page - 1) * limit;

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
            COALESCE(SUM(cpd.customer_price), 0) as total_amount
        FROM customer_pricing_header cp
        LEFT JOIN customer_pricing_details cpd ON cp.pricing_id = cpd.pricing_id
        WHERE 1=1
    `;

    const params = [];

    // Search filter
    if (search) {
        sql += ` AND (
            cp.customer_name LIKE ? OR 
            cp.customer_code LIKE ? OR
            cp.location LIKE ?
        )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status) {
        sql += ' AND cp.status = ?';
        params.push(status);
    }

    // Customer filter
    if (customer_id) {
        sql += ' AND cp.customer_id = ?';
        params.push(customer_id);
    }

    // Group and pagination
    sql += ` 
        GROUP BY cp.pricing_id
        ORDER BY cp.created_at DESC 
        LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit), parseInt(offset));

    // Count query
    const countSql = sql.replace(
        'SELECT cp.pricing_id, cp.customer_id, cp.customer_code, cp.customer_name, cp.from_date, cp.to_date, cp.location, cp.status, cp.created_at, COUNT(cpd.pricing_detail_id) as total_products, COALESCE(SUM(cpd.customer_price), 0) as total_amount',
        'SELECT COUNT(DISTINCT cp.pricing_id) as total'
    ).replace('GROUP BY cp.pricing_id ORDER BY cp.created_at DESC LIMIT ? OFFSET ?', '');

    // Execute queries
    db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
        if (countErr) {
            console.error('Count error:', countErr);
            return res.status(500).json({ error: countErr.message });
        }

        db.query(sql, params, (dataErr, results) => {
            if (dataErr) {
                console.error('Data error:', dataErr);
                return res.status(500).json({ error: dataErr.message });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult[0]?.total || 0,
                    totalPages: Math.ceil((countResult[0]?.total || 0) / limit)
                }
            });
        });
    });
});

// 3. GET SINGLE CUSTOMER PRICING
app.get('/api/customer-pricing/:id', (req, res) => {
    const pricingId = req.params.id;

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
        WHERE cp.pricing_id = ?
        ORDER BY cpd.product_name
    `;

    db.query(sql, [pricingId], (err, results) => {
        if (err) {
            console.error('Get pricing error:', err);
            return res.status(500).json({ error: err.message });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Pricing not found' });
        }

        // Format response
        const pricingData = {
            header: {
                pricing_id: results[0].pricing_id,
                customer_id: results[0].customer_id,
                customer_code: results[0].customer_code,
                customer_name: results[0].customer_name,
                from_date: results[0].from_date,
                to_date: results[0].to_date,
                location: results[0].location,
                status: results[0].status,
                department_name: results[0].department_name,
                category_name: results[0].category_name,
                brand_name: results[0].brand_name,
                product_name: results[0].product_name,
                created_at: results[0].created_at
            },
            products: results
                .filter(row => row.pricing_detail_id) // Only rows with products
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
    });
});

// 4. UPDATE CUSTOMER PRICING STATUS
app.put('/api/customer-pricing/:id/status', (req, res) => {
    const pricingId = req.params.id;
    const { status } = req.body;

    const validStatuses = ['Draft', 'Active', 'Expired', 'Cancelled'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const sql = `
        UPDATE customer_pricing_header 
        SET status = ?, updated_at = NOW() 
        WHERE pricing_id = ?
    `;

    db.query(sql, [status, pricingId], (err, result) => {
        if (err) {
            console.error('Update status error:', err);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Pricing not found' });
        }

        res.json({
            success: true,
            message: `Status updated to ${status}`,
            pricing_id: pricingId,
            new_status: status
        });
    });
});

// 5. DELETE CUSTOMER PRICING
app.delete('/api/customer-pricing/:id', (req, res) => {
    const pricingId = req.params.id;

    // Start transaction
    db.beginTransaction((err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // Delete details first
        db.query('DELETE FROM customer_pricing_details WHERE pricing_id = ?', [pricingId], (err, detailsResult) => {
            if (err) {
                db.rollback(() => {
                    console.error('Delete details error:', err);
                    res.status(500).json({ error: err.message });
                });
                return;
            }

            // Delete header
            db.query('DELETE FROM customer_pricing_header WHERE pricing_id = ?', [pricingId], (err, headerResult) => {
                if (err) {
                    db.rollback(() => {
                        console.error('Delete header error:', err);
                        res.status(500).json({ error: err.message });
                    });
                    return;
                }

                if (headerResult.affectedRows === 0) {
                    db.rollback(() => {
                        res.status(404).json({ error: 'Pricing not found' });
                    });
                    return;
                }

                // Commit
                db.commit((err) => {
                    if (err) {
                        db.rollback(() => {
                            console.error('Commit error:', err);
                            res.status(500).json({ error: err.message });
                        });
                        return;
                    }

                    res.json({
                        success: true,
                        message: 'Customer pricing deleted successfully',
                        pricing_id: pricingId,
                        deleted_products: detailsResult.affectedRows
                    });
                });
            });
        });
    });
});

// 6. GET PRODUCTS FOR PRICING
app.get('/api/products/pricing', (req, res) => {
    const {
        department = '',
        category = '',
        brand = '',
        product = '',
        limit = 50
    } = req.query;

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
        WHERE is_active = TRUE
    `;

    const params = [];

    // Apply filters
    if (department) {
        sql += ' AND department_name LIKE ?';
        params.push(`%${department}%`);
    }

    if (category) {
        sql += ' AND category_name LIKE ?';
        params.push(`%${category}%`);
    }

    if (brand) {
        sql += ' AND brand_name LIKE ?';
        params.push(`%${brand}%`);
    }

    if (product) {
        sql += ' AND (product_name LIKE ? OR product_code LIKE ?)';
        const searchTerm = `%${product}%`;
        params.push(searchTerm, searchTerm);
    }

    sql += ' ORDER BY product_name LIMIT ?';
    params.push(parseInt(limit));

    console.log('📦 Executing products query:', sql, params);

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('❌ Get products error:', err);
            return res.status(500).json({
                success: false,
                error: err.message,
                sqlMessage: err.sqlMessage
            });
        }

        console.log(`✅ Found ${results.length} products`);

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
app.get('/api/products/test', (req, res) => {
    const sql = 'SELECT COUNT(*) as total FROM products';

    db.query(sql, (err, results) => {
        if (err) {
            return res.json({
                success: false,
                message: 'Products table error',
                error: err.message
            });
        }

        res.json({
            success: true,
            message: 'Products API is working',
            total_products: results[0]?.total || 0,
            endpoints: [
                'GET /api/products/pricing - Get products with filters',
                'GET /api/products/test - Test endpoint'
            ]
        });
    });
});
// 7. GET CUSTOMERS FOR DROPDOWN
app.get('/api/customers/dropdown', (req, res) => {
    const sql = `
        SELECT 
            customer_id as value, 
            customer_name as label, 
            customer_code
        FROM customers 
        WHERE is_active = TRUE 
        ORDER BY customer_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// 8. CUSTOMER PRICING TEST ENDPOINT
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
app.post('/api/branches', (req, res) => {
    const branchData = req.body;

    console.log('🏢 Creating branch:', branchData);

    // Validation
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

    const sql = `
        INSERT INTO branches SET ?
    `;

    const dbData = {
        branch_code: branchData.branch_code,
        branch_name: branchData.branch_name,
        address: branchData.address || null,
        address1: branchData.address1 || null,
        address2: branchData.address2 || null,
        city: branchData.city || 'Singapore',
        postal_code: branchData.postal_code || null,
        country: branchData.country || 'Singapore',
        phone: branchData.phone || null,
        email: branchData.email || null,
        is_active: branchData.is_active !== undefined ? branchData.is_active : true
    };

    db.query(sql, dbData, (err, result) => {
        if (err) {
            // Duplicate branch code error
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({
                    success: false,
                    error: 'Branch code already exists. Please use a different code.'
                });
            }
            console.error('❌ Create branch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log('✅ Branch created, ID:', result.insertId);

        // Get the created branch
        db.query('SELECT * FROM branches WHERE branch_id = ?', [result.insertId], (err, results) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.status(201).json({
                success: true,
                message: 'Branch created successfully',
                branch_id: result.insertId,
                branch_code: branchData.branch_code,
                data: results[0]
            });
        });
    });
});

// 2. GET ALL BRANCHES
app.get('/api/branches', (req, res) => {
    const {
        page = 1,
        limit = 10,
        search = '',
        status = 'active'
    } = req.query;

    const offset = (page - 1) * limit;

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

    const params = [];

    // Search filter
    if (search) {
        sql += ` AND (
            branch_code LIKE ? OR 
            branch_name LIKE ? OR 
            city LIKE ? OR
            phone LIKE ?
        )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND is_active = FALSE';
    }

    // Count query
    const countSql = sql.replace(
        'SELECT branch_id, branch_code, branch_name, address, address1, address2, city, postal_code, country, phone, email, is_active, created_at',
        'SELECT COUNT(*) as total'
    );

    // Add ordering and pagination
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    // Execute count query
    db.query(countSql, params.slice(0, -2), (err, countResult) => {
        if (err) {
            console.error('❌ Count error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        // Execute data query
        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Data error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult[0]?.total || 0,
                    totalPages: Math.ceil((countResult[0]?.total || 0) / limit)
                }
            });
        });
    });
});

// 3. GET SINGLE BRANCH
app.get('/api/branches/:id', (req, res) => {
    const branchId = req.params.id;

    const sql = `
        SELECT * FROM branches 
        WHERE branch_id = ? OR branch_code = ?
    `;

    db.query(sql, [branchId, branchId], (err, results) => {
        if (err) {
            console.error('❌ Get branch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// 4. UPDATE BRANCH
app.put('/api/branches/:id', (req, res) => {
    const branchId = req.params.id;
    const updateData = req.body;

    // Get old data first
    db.query('SELECT * FROM branches WHERE branch_id = ?', [branchId], (err, oldResults) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (oldResults.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        const oldData = oldResults[0];

        // Prepare update data
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
            is_active: updateData.is_active !== undefined ? updateData.is_active : oldData.is_active,
            updated_at: new Date()
        };

        // Don't update branch_code
        delete updateFields.branch_code;

        const sql = 'UPDATE branches SET ? WHERE branch_id = ?';

        db.query(sql, [updateFields, branchId], (err, result) => {
            if (err) {
                console.error('❌ Update branch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Branch not found'
                });
            }

            res.json({
                success: true,
                message: 'Branch updated successfully',
                affectedRows: result.affectedRows,
                data: {
                    branch_id: branchId,
                    branch_code: oldData.branch_code,
                    ...updateFields
                }
            });
        });
    });
});

// 5. DELETE BRANCH
app.delete('/api/branches/:id', (req, res) => {
    const branchId = req.params.id;

    const sql = 'DELETE FROM branches WHERE branch_id = ?';

    db.query(sql, [branchId], (err, result) => {
        if (err) {
            console.error('❌ Delete branch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        res.json({
            success: true,
            message: 'Branch deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 6. GET BRANCHES FOR DROPDOWN
app.get('/api/branches/dropdown', (req, res) => {
    const sql = `
        SELECT 
            branch_id as value, 
            CONCAT(branch_name, ' (', branch_code, ')') as label,
            branch_code,
            city
        FROM branches 
        WHERE is_active = TRUE 
        ORDER BY branch_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// 7. CHECK BRANCH CODE AVAILABILITY
app.get('/api/branches/check-code/:code', (req, res) => {
    const branchCode = req.params.code;

    const sql = 'SELECT branch_id FROM branches WHERE branch_code = ?';

    db.query(sql, [branchCode], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            available: results.length === 0,
            exists: results.length > 0
        });
    });
});

// 8. BRANCH STATISTICS
app.get('/api/branches/stats', (req, res) => {
    const sql = `
        SELECT 
            COUNT(*) as total_branches,
            SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_branches,
            SUM(CASE WHEN is_active = FALSE THEN 1 ELSE 0 END) as inactive_branches,
            COUNT(DISTINCT city) as total_cities,
            COUNT(DISTINCT country) as total_countries
        FROM branches
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results[0] || {
                total_branches: 0,
                active_branches: 0,
                inactive_branches: 0,
                total_cities: 0,
                total_countries: 0
            }
        });
    });
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
// ============= BRANCH TABLE APIs =============

// 1. GET BRANCHES FOR TABLE (WITH PAGINATION & FILTERS)
app.get('/api/branches/table', (req, res) => {
    const {
        page = 1,
        limit = 10,
        search = '',
        status = 'all',
        sort_by = 'created_at',
        sort_order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;

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

    const params = [];

    // Search filter
    if (search) {
        sql += ` AND (
            branch_code LIKE ? OR 
            branch_name LIKE ? OR 
            address LIKE ? OR
            city LIKE ? OR
            phone LIKE ? OR
            email LIKE ?
        )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND is_active = FALSE';
    }

    // Count query
    const countSql = sql.replace(
        'SELECT branch_id, branch_code, branch_name, address, city, postal_code, country, phone, email, is_active, created_at',
        'SELECT COUNT(*) as total'
    );

    // Add ordering and pagination
    sql += ` ORDER BY ${sort_by} ${sort_order} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    // Execute count query
    db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Branch count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        // Execute data query
        db.query(sql, params, (dataErr, results) => {
            if (dataErr) {
                console.error('❌ Branch data error:', dataErr);
                return res.status(500).json({
                    success: false,
                    error: dataErr.message
                });
            }

            // Format results for frontend
            const formattedResults = results.map(branch => ({
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
                    total: countResult[0]?.total || 0,
                    totalPages: Math.ceil((countResult[0]?.total || 0) / limit)
                }
            });
        });
    });
});

// 2. BULK UPDATE BRANCH STATUS
app.put('/api/branches/bulk-status', (req, res) => {
    const { branch_ids, is_active } = req.body;

    if (!branch_ids || !Array.isArray(branch_ids) || branch_ids.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Branch IDs are required'
        });
    }

    const sql = `
        UPDATE branches 
        SET is_active = ?, updated_at = NOW() 
        WHERE branch_id IN (?)
    `;

    db.query(sql, [is_active, branch_ids], (err, result) => {
        if (err) {
            console.error('❌ Bulk update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            message: `${result.affectedRows} branch(es) updated`,
            affectedRows: result.affectedRows
        });
    });
});
// 3. EXPORT BRANCHES (CSV/Excel)
app.get('/api/branches/export', (req, res) => {
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
            CASE WHEN is_active = TRUE THEN 'Active' ELSE 'Inactive' END as "Status",
            DATE(created_at) as "Created Date"
        FROM branches 
        ORDER BY created_at DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Export error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length,
            export_date: new Date().toISOString()
        });
    });
});
// ============= Vendors =============
// POST: /api/vendors - Create new vendor
app.post('/api/vendors', (req, res) => {
    const vendorData = req.body;

    console.log('📦 Creating vendor:', vendorData);
    delete vendorData.created_by;

    // Or set to NULL explicitly
    vendorData.created_by = null;

    // FIX 2: Set default values for NOT NULL fields
    const defaults = {
        vendor_name: vendorData.vendor_name || 'New Vendor',
        contact_person : vendorData.contact_person || vendorData.vendor_name || '',
        currency: vendorData.currency || 'SGD',
        gst_type: vendorData.gst_type || 'Exclusive',
        is_active: vendorData.is_active !== undefined ? vendorData.is_active : true,
        city: vendorData.city || 'Singapore',
        country: vendorData.country || 'Singapore',
        payment_terms: vendorData.payment_terms || '30 Days',
        debit_limit: vendorData.debit_limit || '0.00',
        debit_on_hold: vendorData.debit_on_hold || '0.00',
        created_at: new Date()
    };

    // Merge with vendorData
    const finalData = { ...defaults, ...vendorData };

    // Remove any undefined values
    Object.keys(finalData).forEach(key => {
        if (finalData[key] === undefined) {
            delete finalData[key];
        }
    });

    console.log('Final vendor data:', finalData);

    const sql = 'INSERT INTO vendors SET ?';

    db.query(sql, finalData, (err, result) => {
        if (err) {
            console.error('❌ Vendor create error:', err);

            // More detailed error handling
            if (err.code === 'ER_NO_REFERENCED_ROW_2') {
                // Foreign key error - create a default user
                return createDefaultUserAndRetry(vendorData, res);
            }

            return res.status(500).json({
                success: false,
                error: err.message,
                code: err.code
            });
        }

        console.log('✅ Vendor created, ID:', result.insertId);

        res.status(201).json({
            success: true,
            message: 'Vendor created successfully',
            vendor_id: result.insertId,
            vendor_code: finalData.vendor_code,
            data: finalData
        });
    });
});
// GET: /api/accounts/for-vendor-all - Get ALL accounts for vendor dropdown
app.get('/api/accounts/for-vendor-all', (req, res) => {
    console.log('📊 Fetching ALL accounts for vendor dropdown...');
    
    try {
        // Get ALL accounts (BOTH placeholder and non-placeholder)
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
                -- Sort by account code (natural ordering)
                CAST(SUBSTRING_INDEX(account_code, '-', 1) AS UNSIGNED),
                CASE 
                    WHEN LOCATE('-', account_code) > 0 
                    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(account_code, '-', 2), '-', -1) AS UNSIGNED)
                    ELSE 0 
                END,
                CASE 
                    WHEN (LENGTH(account_code) - LENGTH(REPLACE(account_code, '-', ''))) >= 2
                    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(account_code, '-', 3), '-', -1) AS UNSIGNED)
                    ELSE 0 
                END,
                root_level
        `;
        
        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Accounts fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }
            
            console.log(`✅ Found ${results.length} accounts for vendor dropdown`);
            
            res.json({
                success: true,
                data: results,
                count: results.length
            });
        });
        
    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// GET: /api/vendors - Get all vendors with filters
app.get('/api/vendors', (req, res) => {
    const {
        
        page = 1,
        limit = 10,
        search = '',
        status = '',
        sort_by = 'vendor_id',
        sort_order = 'ASC'
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    console.log(`📊 Fetching vendors: page=${page}, limit=${limit}, search=${search}`);
    
    let sql = `
        SELECT 
            v.*,
            DATE_FORMAT(v.created_at, '%Y-%m-%d %H:%i:%s') as created_at_formatted,
            u.username as created_by_name
        FROM vendors v
        LEFT JOIN users u ON v.created_by = u.user_id
        WHERE 1=1
        
    `;
    
    const params = [];
    
    // Search filter
    if (search) {
        sql += ` AND (
         
            v.vendor_code LIKE ? OR 
            v.vendor_name LIKE ? OR 
            v.email LIKE ? OR
            v.mobile_no LIKE ? OR
            v.registration_no LIKE ?
        )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Status filter
    if (status === 'active') {
        sql += ' AND v.is_active = 1';
    } else if (status === 'inactive') {
        sql += ' AND v.is_active = 0';
    }
    
    // Count query
    const countSql = sql.replace(
        'SELECT v.*, DATE_FORMAT(v.created_at, \'%Y-%m-%d %H:%i:%s\') as created_at_formatted, u.username as created_by_name',
        'SELECT COUNT(*) as total'
    );
    
    // Add sorting - ALWAYS show newest first by default
    sql += ` ORDER BY ${sort_by} ${sort_order} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    console.log('SQL Query:', sql);
    console.log('SQL Params:', params);
    
    // Execute count query
    db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({ success: false, error: countErr.message });
        }
        
        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);
        
        console.log(`Total vendors: ${total}, Total pages: ${totalPages}`);
        
        // Execute main query
        db.query(sql, params, (dataErr, results) => {
            if (dataErr) {
                console.error('❌ Data error:', dataErr);
                return res.status(500).json({ success: false, error: dataErr.message });
            }
            
            console.log(`✅ Found ${results.length} vendors`);
            
            // Format results for frontend
            const formattedResults = results.map(vendor => ({
                ...vendor,
                status: vendor.is_active ? 'Active' : 'Inactive',
                status_color: vendor.is_active ? '#10b981' : '#ef4444',
                created_at_display: vendor.created_at_formatted || 
                                   new Date(vendor.created_at).toLocaleString()
            }));
            
            res.json({
        success: true,
        data: formattedResults,
        pagination: {  // ✅ Make sure this structure is correct
            page: parseInt(page),
            limit: parseInt(limit),
            total: total,
            totalPages: totalPages,
            has_next: page < totalPages,
            has_prev: page > 1
        }
            });
        });
    });
});
// GET: /api/vendors/:id - Get single vendor details
// server.js-ல் vendor details API-ஐ இப்படி update பண்ணுங்க:
app.get('/api/vendors/:id', (req, res) => {
    const vendorId = req.params.id;
    
    console.log(`🔍 Fetching vendor ${vendorId} for edit...`);
    
    const sql = `
        SELECT 
            v.*,
            u.username as created_by_name,
            -- ✅ Get account details if ap_account exists
            ca.account_code as ap_account_code,
            ca.account_name as ap_account_name,
            ca.is_placeholder as ap_account_is_placeholder
        FROM vendors v
        LEFT JOIN users u ON v.created_by = u.user_id
        LEFT JOIN chart_of_accounts ca ON v.ap_account = ca.account_id
        WHERE v.vendor_id = ?
    `;
    
    db.query(sql, [vendorId], (err, results) => {
        if (err) {
            console.error('❌ Vendor fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
        
        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }
        
        const vendor = results[0];
        
        // ✅ Ensure we have proper account data
        if (vendor.ap_account_id && vendor.ap_account_name) {
            vendor.ap_account_display = `${vendor.ap_account_code} - ${vendor.ap_account_name}`;
        } else if (vendor.ap_account) {
            vendor.ap_account_display = vendor.ap_account;
        }
        
        console.log('✅ Vendor data for edit:', {
            id: vendor.vendor_id,
            name: vendor.vendor_name,
            ap_account: vendor.ap_account,
            ap_account_display: vendor.ap_account_display,
            currency: vendor.currency
        });
           vendor.is_active = vendor.is_active === 1 || vendor.is_active === true;
        vendor.is_non_trade_creditor = vendor.is_non_trade_creditor === 1 || vendor.is_non_trade_creditor === true;
        vendor.tr_vendor = vendor.tr_vendor === 1 || vendor.tr_vendor === true;
        
        console.log('✅ Vendor boolean fields:', {
            is_active: vendor.is_active,
            is_non_trade_creditor: vendor.is_non_trade_creditor,
            tr_vendor: vendor.tr_vendor,
            raw_tr_vendor: results[0].tr_vendor // Log raw value
        });
        res.json({
            success: true,
            data: vendor
        });
    });
});
// PUT: /api/vendors/:id - Update vendor
// PUT: /api/vendors/:id - Update vendor with contact person
app.put('/api/vendors/:id', (req, res) => {
    const vendorId = req.params.id;
    const updateData = req.body;
    
    console.log(`✏️ Updating vendor ${vendorId}`);
    console.log('Update data:', updateData);
    
    // Check if vendor exists
    const checkSql = 'SELECT vendor_id FROM vendors WHERE vendor_id = ?';
    
    db.query(checkSql, [vendorId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }
        
        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }
        
        // Prepare update data
        const updateFields = {
            // Basic Information
            vendor_name: updateData.vendor_name,
            registration_no: updateData.registration_no || null,
            currency: updateData.currency || 'SGD',
            gst_registered: updateData.gst_registered || null,
            gst_type: updateData.gst_type || 'Exclusive',
            mobile_no: updateData.mobile_no || null,
            vendor_type: updateData.vendor_type || null,
            remarks: updateData.remarks || null,
            is_non_trade_creditor: updateData.is_non_trade_creditor || false,
            tr_vendor: updateData.tr_vendor || null,
            is_active: updateData.is_active !== undefined ? updateData.is_active : true,
            ap_account: updateData.ap_account || '2-1001-ACCOUNT PAYABLE',
            
            // ✅ CONTACT PERSONS - ADD THIS
            contact_person: updateData.contact_person || updateData.vendor_name || null,
            
            
            // Address Information
            address: updateData.address || null,
            address2: updateData.address2 || null,
            city: updateData.city || 'Singapore',
            state: updateData.state || null,
            country: updateData.country || 'Singapore',
            postal_code: updateData.postal_code || null,
            
            // Contact Information
            phone1: updateData.phone1 || null,
            phone2: updateData.phone2 || null,
            phone3: updateData.phone3 || null,
            fax: updateData.fax || null,
            email: updateData.email || null,
            url: updateData.url || null,
            
            // Payment Information
            payment_terms: updateData.payment_terms || '30 Days',
            debit_limit: parseFloat(updateData.debit_limit || 0),
            debit_on_hold: parseFloat(updateData.debit_on_hold || 0),
            bank_name: updateData.bank_name || null,
            bank_account_no: updateData.bank_account_no || null,
            paynow_uen_no: updateData.paynow_uen_no || null,
            
            // Timestamp
            updated_at: new Date()
        };
        
        // Remove undefined values
        Object.keys(updateFields).forEach(key => {
            if (updateFields[key] === undefined) {
                delete updateFields[key];
            }
        });
        
        console.log('Final update fields:', updateFields);
        
        // Update vendor
        const sql = 'UPDATE vendors SET ? WHERE vendor_id = ?';
        
        db.query(sql, [updateFields, vendorId], (updateErr, result) => {
            if (updateErr) {
                console.error('❌ Update vendor error:', updateErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + updateErr.message,
                    code: updateErr.code,
                    sqlMessage: updateErr.sqlMessage
                });
            }
            
            console.log(`✅ Vendor ${vendorId} updated successfully. Affected rows: ${result.affectedRows}`);
            
            res.json({
                success: true,
                message: 'Vendor updated successfully',
                vendor_id: vendorId,
                affectedRows: result.affectedRows,
                updated_fields: Object.keys(updateFields)
            });
        });
    });
});
// DELETE: /api/vendors/:id - Delete vendor
app.delete('/api/vendors/:id/hard', (req, res) => {
    const vendorId = req.params.id;

    // HARD DELETE (permanent)
    const sql = 'DELETE FROM vendors WHERE vendor_id = ?';

    db.query(sql, [vendorId], (err, result) => {
        if (err) {
            // Check for foreign key constraints
            if (err.code === 'ER_ROW_IS_REFERENCED_2') {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete vendor. It has related records in other tables.'
                });
            }
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Vendor not found'
            });
        }

        res.json({
            success: true,
            message: `Vendor PERMANENTLY DELETED`,
            vendor_id: vendorId,
            affectedRows: result.affectedRows
        });
    });
});
// GET: /api/vendors/dropdown - For dropdown selection
app.get('/api/vendors/dropdown', (req, res) => {
    const sql = `
        SELECT 
            vendor_id as value, 
            CONCAT(vendor_code, ' - ', vendor_name) as label,
            vendor_code,
            vendor_name
        FROM vendors 
        WHERE is_active = TRUE 
        ORDER BY vendor_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// GET: /api/vendor-types - Vendor types for dropdown
app.get('/api/vendor-types', (req, res) => {
    const sql = `
        SELECT 
            type_id as value, 
            type_name as label,
            type_code
        FROM vendor_types 
        WHERE is_active = TRUE 
        ORDER BY type_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// GET: /api/ap-accounts - AP accounts for dropdown
app.get('/api/ap-accounts', (req, res) => {
    const sql = `
        SELECT 
            account_id as value, 
            CONCAT(account_code, ' - ', account_name) as label,
            account_code,
            account_name
        FROM ap_accounts 
        WHERE is_active = TRUE 
        ORDER BY account_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});
// GET: /api/vendors/stats - Vendor statistics
app.get('/api/vendors/stats', (req, res) => {
    const sql = `
        SELECT 
            COUNT(*) as total_vendors,
            SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_vendors,
            SUM(CASE WHEN is_active = FALSE THEN 1 ELSE 0 END) as inactive_vendors,
            SUM(debit_limit) as total_debit_limit,
            SUM(debit_on_hold) as total_debit_on_hold,
            COUNT(DISTINCT vendor_type) as vendor_types_count,
            COUNT(DISTINCT country) as countries_count
        FROM vendors
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results[0] || {
                total_vendors: 0,
                active_vendors: 0,
                inactive_vendors: 0,
                total_debit_limit: 0,
                total_debit_on_hold: 0,
                vendor_types_count: 0,
                countries_count: 0
            }
        });
    });
});
// GET: /api/vendors/check-code/:code - Check if vendor code exists
app.get('/api/vendors/check-code/:code', (req, res) => {
    const vendorCode = req.params.code;

    const sql = 'SELECT vendor_id FROM vendors WHERE vendor_code = ?';

    db.query(sql, [vendorCode], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            available: results.length === 0,
            exists: results.length > 0
        });
    });
});
// ============================= CURRENCIES FOR DROPDOWN =============================
app.get('/api/currencies/dropdown', (req, res) => {
    console.log('💰 Fetching currencies for dropdown...');
    
    try {
        const sql = `
            SELECT 
                currency_id,
                CONCAT(currency_code, ' - ', currency_name) as display_name,
                currency_code,
                currency_name,
                currency_symbol,
                is_active
            FROM currencies 
            WHERE is_active = 1
            ORDER BY currency_code
        `;
        
        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Currencies fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }
            
            console.log(`✅ Found ${results.length} active currencies`);
            
            res.json({
                success: true,
                data: results
            });
        });
        
    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================= CHART OF ACCOUNTS FOR VENDOR (AP ACCOUNTS) =============================
app.get('/api/accounts/for-vendor', (req, res) => {
    console.log('📊 Fetching accounts for vendor dropdown...');
    
    try {
        // Get accounts with type like 'PAYABLE' or 'LIABILITY'
        const sql = `
            SELECT 
                account_id,
                CONCAT(account_code, ' - ', account_name) as display_name,
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
        
        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Accounts fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }
            
            console.log(`✅ Found ${results.length} accounts for vendor dropdown`);
            
            // If no accounts found, get all non-placeholder accounts
            if (results.length === 0) {
                console.log('No AP accounts found, fetching all non-placeholder accounts...');
                
                const fallbackSql = `
                    SELECT 
                        account_id,
                        CONCAT(account_code, ' - ', account_name) as display_name,
                        account_code,
                        account_name,
                        account_type,
                        is_placeholder
                    FROM chart_of_accounts 
                    WHERE is_active = 1 
                    AND is_placeholder = 0
                    ORDER BY account_code
                `;
                
                db.query(fallbackSql, (err, fallbackResults) => {
                    if (err) {
                        return res.status(500).json({
                            success: false,
                            error: err.message
                        });
                    }
                    
                    res.json({
                        success: true,
                        data: fallbackResults,
                        message: 'Showing all accounts (no specific AP accounts found)'
                    });
                });
            } else {
                res.json({
                    success: true,
                    data: results
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= SALES QUOTATION APIs =============

// 1. CREATE NEW SALES QUOTATION
app.post('/api/sales-quotations', (req, res) => {
    console.log('📄 Creating sales quotation...');

    const quotationData = req.body;
    console.log('Received data:', quotationData);

    // VALIDATION
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

    // PREPARE DATA - Remove undefined/null values
    const cleanData = {};

    // Add all fields with defaults
    const fields = {
        // Quotation Info
        quotation_no: quotationData.quotation_no || generateQuotationNo(),
        quotation_date: quotationData.quotation_date,
        expiry_date: quotationData.expiry_date || null,
        currency: quotationData.currency || 'SGD',
        gst_type: quotationData.gst_type || 'Exclusive',
        manual_no: quotationData.manual_no || null,

        // Customer
        customer_id: parseInt(quotationData.customer_id) || null,
        customer_code: quotationData.customer_code || '',
        customer_name: quotationData.customer_name || '',
        attention: quotationData.attention || '',
        customer_email: quotationData.customer_email || '',

        // Project
        project_code: quotationData.project_code || null,
        project_name: quotationData.project_name || '',

        // Sales
        salesman_name: quotationData.salesman_name || '',

        // Billing Address
        billing_address1: quotationData.billing_address1 || '',
        billing_address2: quotationData.billing_address2 || '',
        billing_city: quotationData.billing_city || 'Singapore',
        billing_postal: quotationData.billing_postal || '',
        billing_country: quotationData.billing_country || 'Singapore',

        // Delivery Address
        delivery_address1: quotationData.delivery_address1 || '',
        delivery_address2: quotationData.delivery_address2 || '',
        delivery_city: quotationData.delivery_city || 'Singapore',
        delivery_postal: quotationData.delivery_postal || '',
        delivery_country: quotationData.delivery_country || 'Singapore',
        same_as_billing: quotationData.same_as_billing ? 1 : 0,

        // Extra Info
        incoterms: quotationData.incoterms || null,
        delivery_by: quotationData.delivery_by || null,
        delivery_date: quotationData.delivery_date || null,
        contact_number: quotationData.contact_number || '',
        customer_reference: quotationData.customer_reference || null,
        payment_terms: quotationData.payment_terms || null,
        shipping_method: quotationData.shipping_method || null,

        // Totals
        subtotal: parseFloat(quotationData.subtotal) || 0.00,
        discount_amount: parseFloat(quotationData.discount_amount) || 0.00,
        discount_type: quotationData.discount_type || 'amount',
        gst_amount: parseFloat(quotationData.gst_amount) || 0.00,
        grand_total: parseFloat(quotationData.grand_total) || 0.00,

        // Status
        status: 'Draft',

        // Audit
        created_by: 1
    };

    // Remove undefined values
    Object.keys(fields).forEach(key => {
        if (fields[key] !== undefined) {
            cleanData[key] = fields[key];
        }
    });

    console.log('📦 Clean data for insertion:', cleanData);
    console.log('SQL will be:', 'INSERT INTO sales_quotations SET ' + JSON.stringify(cleanData));

    // SIMPLE INSERT WITHOUT TRANSACTION (First make it work)
    const sql = 'INSERT INTO sales_quotations SET ?';

    db.query(sql, cleanData, (err, result) => {
        if (err) {
            console.error('❌ SQL Error:', err);
            console.error('SQL Message:', err.sqlMessage);
            console.error('SQL Code:', err.code);
            console.error('SQL:', err.sql);

            return res.status(500).json({
                success: false,
                error: 'Database error: ' + err.message,
                sqlMessage: err.sqlMessage,
                code: err.code
            });
        }

        const quotationId = result.insertId;
        console.log('✅ Quotation created, ID:', quotationId);

        // Now handle items if any
        if (quotationData.items && quotationData.items.length > 0) {
            let itemsProcessed = 0;
            let itemErrors = [];

            quotationData.items.forEach((item, index) => {
                const itemData = {
                    quotation_id: quotationId,
                    product_id: item.product_id || null,
                    product_code: item.product_code || '',
                    product_name: item.product_name || '',
                    uom: item.uom || 'PCS',
                    quantity: parseFloat(item.quantity) || 1.000,
                    unit_price: parseFloat(item.unit_price) || 0.00,
                    gst_rate: parseFloat(item.gst_rate) || 7.00,
                    gst_amount: parseFloat(item.gst_amount) || 0.00,
                    item_amount: parseFloat(item.item_amount) || 0.00
                };

                const itemSql = 'INSERT INTO sales_quotation_items SET ?';

                db.query(itemSql, itemData, (itemErr, itemResult) => {
                    if (itemErr) {
                        console.error('❌ Item insert error:', itemErr);
                        itemErrors.push({
                            product: item.product_name,
                            error: itemErr.message
                        });
                    } else {
                        itemsProcessed++;
                    }

                    // Last item
                    if (index === quotationData.items.length - 1) {
                        if (itemErrors.length > 0) {
                            console.warn('⚠️ Some items failed:', itemErrors);
                        }

                        res.status(201).json({
                            success: true,
                            message: 'Quotation created with items',
                            quotation_id: quotationId,
                            quotation_no: cleanData.quotation_no,
                            items_processed: itemsProcessed,
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
                    }
                });
            });
        } else {
            // No items
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
    });
});

// 2. GET ALL SALES QUOTATIONS
app.get('/api/sales-quotations', (req, res) => {
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

    const params = [];

    // Search filter
    if (search) {
        sql += ` AND (
            sq.quotation_no LIKE ? OR 
            sq.customer_name LIKE ? OR
            sq.customer_code LIKE ?
        )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status) {
        sql += ' AND sq.status = ?';
        params.push(status);
    }

    // Customer filter
    if (customer_id) {
        sql += ' AND sq.customer_id = ?';
        params.push(customer_id);
    }

    // Date range filter
    if (start_date && end_date) {
        sql += ' AND sq.quotation_date BETWEEN ? AND ?';
        params.push(start_date, end_date);
    }

    // Group and pagination
    sql += ` 
        GROUP BY sq.quotation_id
        ORDER BY ${sort_by} ${sort_order}
        LIMIT ? OFFSET ?
    `;
    params.push(parseInt(limit), parseInt(offset));

    // Count query
    const countSql = sql.replace(
        'SELECT sq.quotation_id, sq.quotation_no, sq.quotation_date, sq.expiry_date, sq.customer_name, sq.customer_code, sq.currency, sq.status, sq.subtotal, sq.discount_amount, sq.gst_amount, sq.grand_total, sq.created_at, COUNT(sqi.item_id) as items_count',
        'SELECT COUNT(DISTINCT sq.quotation_id) as total'
    ).replace('GROUP BY sq.quotation_id ORDER BY ' + sort_by + ' ' + sort_order + ' LIMIT ? OFFSET ?', '');

    // Execute queries
    db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
        if (countErr) {
            console.error('Count error:', countErr);
            return res.status(500).json({ error: countErr.message });
        }

        db.query(sql, params, (dataErr, results) => {
            if (dataErr) {
                console.error('Data error:', dataErr);
                return res.status(500).json({ error: dataErr.message });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult[0]?.total || 0,
                    totalPages: Math.ceil((countResult[0]?.total || 0) / limit)
                }
            });
        });
    });
});

// 3. GET SINGLE QUOTATION WITH ITEMS
app.get('/api/sales-quotations/:id', (req, res) => {
    const quotationId = req.params.id;

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
        WHERE sq.quotation_id = ?
        ORDER BY sqi.item_id
    `;

    db.query(sql, [quotationId], (err, results) => {
        if (err) {
            console.error('Get quotation error:', err);
            return res.status(500).json({ error: err.message });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: 'Quotation not found' });
        }

        // Format response
        const quotationData = {
            header: {
                quotation_id: results[0].quotation_id,
                quotation_no: results[0].quotation_no,
                quotation_date: results[0].quotation_date,
                expiry_date: results[0].expiry_date,
                currency: results[0].currency,
                gst_type: results[0].gst_type,
                manual_no: results[0].manual_no,
                customer_id: results[0].customer_id,
                customer_code: results[0].customer_code,
                customer_name: results[0].customer_name,
                attention: results[0].attention,
                customer_email: results[0].customer_email,
                project_code: results[0].project_code,
                project_name: results[0].project_name,
                salesman_name: results[0].salesman_name,
                billing_address1: results[0].billing_address1,
                billing_address2: results[0].billing_address2,
                billing_city: results[0].billing_city,
                billing_postal: results[0].billing_postal,
                billing_country: results[0].billing_country,
                delivery_address1: results[0].delivery_address1,
                delivery_address2: results[0].delivery_address2,
                delivery_city: results[0].delivery_city,
                delivery_postal: results[0].delivery_postal,
                delivery_country: results[0].delivery_country,
                same_as_billing: results[0].same_as_billing,
                incoterms: results[0].incoterms,
                delivery_by: results[0].delivery_by,
                delivery_date: results[0].delivery_date,
                contact_number: results[0].contact_number,
                customer_reference: results[0].customer_reference,
                payment_terms: results[0].payment_terms,
                shipping_method: results[0].shipping_method,
                subtotal: results[0].subtotal,
                discount_amount: results[0].discount_amount,
                discount_type: results[0].discount_type,
                gst_amount: results[0].gst_amount,
                grand_total: results[0].grand_total,
                status: results[0].status,
                created_at: results[0].created_at
            },
            items: results
                .filter(row => row.item_id) // Only rows with items
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
    });
});

// 4. UPDATE QUOTATION STATUS
app.put('/api/sales-quotations/:id/status', (req, res) => {
    const quotationId = req.params.id;
    const { status } = req.body;

    const validStatuses = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const sql = `
        UPDATE sales_quotations 
        SET status = ?, updated_at = NOW() 
        WHERE quotation_id = ?
    `;

    db.query(sql, [status, quotationId], (err, result) => {
        if (err) {
            console.error('Update status error:', err);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Quotation not found' });
        }

        res.json({
            success: true,
            message: `Status updated to ${status}`,
            quotation_id: quotationId,
            new_status: status
        });
    });
});

// 5. DELETE SALES QUOTATION
app.delete('/api/sales-quotations/:id', (req, res) => {
    const quotationId = req.params.id;

    // Start transaction
    db.beginTransaction((err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // Delete items first
        db.query('DELETE FROM sales_quotation_items WHERE quotation_id = ?', [quotationId], (err, itemsResult) => {
            if (err) {
                db.rollback(() => {
                    console.error('Delete items error:', err);
                    res.status(500).json({ error: err.message });
                });
                return;
            }

            // Delete attachments
            db.query('DELETE FROM sales_quotation_attachments WHERE quotation_id = ?', [quotationId], (err, attachmentsResult) => {
                if (err) {
                    db.rollback(() => {
                        console.error('Delete attachments error:', err);
                        res.status(500).json({ error: err.message });
                    });
                    return;
                }

                // Delete quotation
                db.query('DELETE FROM sales_quotations WHERE quotation_id = ?', [quotationId], (err, headerResult) => {
                    if (err) {
                        db.rollback(() => {
                            console.error('Delete header error:', err);
                            res.status(500).json({ error: err.message });
                        });
                        return;
                    }

                    if (headerResult.affectedRows === 0) {
                        db.rollback(() => {
                            res.status(404).json({ error: 'Quotation not found' });
                        });
                        return;
                    }

                    // Commit
                    db.commit((err) => {
                        if (err) {
                            db.rollback(() => {
                                console.error('Commit error:', err);
                                res.status(500).json({ error: err.message });
                            });
                            return;
                        }

                        res.json({
                            success: true,
                            message: 'Sales quotation deleted successfully',
                            quotation_id: quotationId,
                            deleted_items: itemsResult.affectedRows,
                            deleted_attachments: attachmentsResult.affectedRows
                        });
                    });
                });
            });
        });
    });
});

// 6. GET CUSTOMERS FOR DROPDOWN (For quotation form)
app.get('/api/customers/quotation-dropdown', (req, res) => {
    const sql = `
        SELECT 
            customer_id as value, 
            CONCAT(customer_code, ' - ', customer_name) as label,
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
        WHERE is_active = TRUE AND is_blocked = FALSE
        ORDER BY customer_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// 7. GET PRODUCTS FOR QUOTATION
app.get('/api/products/quotation', (req, res) => {
    const {
        search = '',
        category = '',
        limit = 50
    } = req.query;

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
        WHERE is_active = TRUE
    `;

    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (product_name LIKE ? OR product_code LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    // Category filter
    if (category) {
        sql += ' AND category_name LIKE ?';
        params.push(`%${category}%`);
    }

    sql += ' ORDER BY product_name LIMIT ?';
    params.push(parseInt(limit));

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('Get products error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});

// 8. QUOTATION STATISTICS
app.get('/api/sales-quotations/stats', (req, res) => {
    const { period = 'month' } = req.query; // day, week, month, year

    let dateFilter = '';
    switch (period) {
        case 'day':
            dateFilter = 'DATE(created_at) = CURDATE()';
            break;
        case 'week':
            dateFilter = 'YEARWEEK(created_at) = YEARWEEK(CURDATE())';
            break;
        case 'month':
            dateFilter = 'YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())';
            break;
        case 'year':
            dateFilter = 'YEAR(created_at) = YEAR(CURDATE())';
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

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Stats error:', err);
            return res.status(500).json({ error: err.message });
        }

        res.json({
            success: true,
            data: results[0] || {
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
    });
});

// 9. UPLOAD QUOTATION ATTACHMENT
app.post('/api/sales-quotations/:id/attachments', (req, res) => {
    const quotationId = req.params.id;

    // Note: For file uploads, you'd need multer middleware
    // This is a simplified version

    const attachmentData = {
        quotation_id: quotationId,
        document_type: req.body.document_type || 'QUOTATION',
        file_name: req.body.file_name,
        file_path: req.body.file_path,
        file_size: req.body.file_size,
        mime_type: req.body.mime_type,
        uploaded_by: 1 // From session
    };

    const sql = 'INSERT INTO sales_quotation_attachments SET ?';

    db.query(sql, attachmentData, (err, result) => {
        if (err) {
            console.error('Upload attachment error:', err);
            return res.status(500).json({ error: err.message });
        }

        res.status(201).json({
            success: true,
            message: 'Attachment uploaded successfully',
            attachment_id: result.insertId,
            file_name: attachmentData.file_name
        });
    });
});

// 10. TEST ENDPOINT
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
app.post('/api/sales-quotations/minimal', (req, res) => {
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

    const sql = 'INSERT INTO sales_quotations SET ?';

    db.query(sql, minimalData, (err, result) => {
        if (err) {
            console.error('Test error:', err);
            return res.json({
                success: false,
                error: err.message,
                sqlMessage: err.sqlMessage
            });
        }

        res.json({
            success: true,
            message: 'Minimal test successful',
            quotation_id: result.insertId
        });
    });
});
// Add this to server.js

// GET: /api/customers/active - Get active customers for dropdown
app.get('/api/customers/active', (req, res) => {
    console.log('🎯 /api/customers/active called');

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
        LIMIT 100
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
app.post('/api/sales-quotations/simple', (req, res) => {
    const data = req.body;

    // If customer_id doesn't exist in customers table, set to NULL
    const checkSql = 'SELECT customer_id FROM customers WHERE customer_id = ?';

    db.query(checkSql, [data.customer_id], (err, results) => {
        if (err) {
            console.error('Check customer error:', err);
            // Continue anyway
            insertWithPossibleNull(data, res);
            return;
        }

        if (results.length === 0) {
            console.log('⚠️ Customer ID not found, setting to NULL');
            data.customer_id = null;
        }

        insertWithPossibleNull(data, res);
    });
});
// ============= Departments =============
// POST: /api/departments - Create new department
// CORRECTED VERSION:
// Add to your server.js - Hierarchy endpoint
app.get('/api/accounts/hierarchy', (req, res) => {
    console.log('🌳 Fetching accounts hierarchy...');

    const sql = `
        WITH RECURSIVE account_hierarchy AS (
            -- Anchor: Root accounts (no parent)
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
                CAST(account_code AS CHAR(1000)) as path
            FROM chart_of_accounts 
            WHERE parent_account_id IS NULL
            
            UNION ALL
            
            -- Recursive: Child accounts
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
                CONCAT(h.path, ' > ', c.account_code)
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
            -- First by root level
            root_level,
            -- Then by account code for natural sorting
            CAST(SUBSTRING_INDEX(account_code, '-', 1) AS UNSIGNED),
            CASE 
                WHEN LOCATE('-', account_code) > 0 
                THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(account_code, '-', 2), '-', -1) AS UNSIGNED)
                ELSE 0 
            END,
            CASE 
                WHEN (LENGTH(account_code) - LENGTH(REPLACE(account_code, '-', ''))) >= 2
                THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(account_code, '-', 3), '-', -1) AS UNSIGNED)
                ELSE 0 
            END,
            account_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Hierarchy error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log(`✅ Hierarchy: ${results.length} accounts loaded`);

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
app.post('/api/departments', (req, res) => {
    console.log('📦 Creating department with logo...');

    try {
        const deptData = req.body;

        // Check if logo data too big
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

        // Handle logo base64 data
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
            is_service: false,
            is_active: true,
            created_at: new Date()
        };

        const finalData = { ...defaults, ...deptData };

        // Remove undefined
        Object.keys(finalData).forEach(key => {
            if (finalData[key] === undefined) delete finalData[key];
        });

        const sql = 'INSERT INTO departments SET ?';

        db.query(sql, finalData, (err, result) => {
            if (err) {
                console.error('❌ Department create error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.status(201).json({
                success: true,
                message: 'Department created successfully with logo',
                department_id: result.insertId,
                department_code: finalData.department_code,
                has_logo: !!finalData.logo_base64
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
app.put('/api/departments/:id', (req, res) => {
    const deptId = req.params.id;
    const updateData = req.body;

    console.log(`📝 PUT /api/departments/${deptId}`);
    console.log('Update data:', updateData);

    // Check if department exists first
    const checkSql = 'SELECT * FROM departments WHERE department_id = ?';

    db.query(checkSql, [deptId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Department ID ${deptId} not found`
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Update department
        const updateSql = 'UPDATE departments SET ? WHERE department_id = ?';

        db.query(updateSql, [updateData, deptId], (updateErr, result) => {
            if (updateErr) {
                console.error('❌ Update error:', updateErr);
                return res.status(500).json({
                    success: false,
                    error: 'Update failed: ' + updateErr.message
                });
            }

            console.log('✅ Department updated, affected rows:', result.affectedRows);

            res.json({
                success: true,
                message: 'Department updated successfully',
                department_id: deptId,
                affectedRows: result.affectedRows,
                data: updateData
            });
        });
    });
});
// DELETE: /api/departments/:id - Delete department
app.delete('/api/departments/:id', (req, res) => {
    const deptId = req.params.id;
    console.log('🗑️ CASCADE DELETE department:', deptId);

    // Direct delete - categories will be deleted automatically due to CASCADE
    const deleteSql = 'DELETE FROM departments WHERE department_id = ?';

    db.query(deleteSql, [deptId], (deleteErr, result) => {
        if (deleteErr) {
            console.error('❌ Delete error:', deleteErr);
            return res.status(500).json({
                success: false,
                error: 'Delete failed: ' + deleteErr.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: `Department ID ${deptId} not found`
            });
        }

        console.log('✅ Department deleted with CASCADE');

        res.json({
            success: true,
            message: 'Department and associated categories deleted',
            department_id: deptId,
            affectedRows: result.affectedRows
        });
    });
});
// GET: /api/departments - Get all departments
app.get('/api/departments', (req, res) => {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    console.log(`📊 Fetching departments - Page: ${page}, Limit: ${limit}, Search: "${search}"`);

    // Base query
    let sql = `
        SELECT 
            d.*,
            u.username as created_by_name
        FROM departments d
        LEFT JOIN users u ON d.created_by = u.user_id
        WHERE 1=1
    `;

    let countSql = `SELECT COUNT(*) as total FROM departments d WHERE 1=1`;
    const params = [];
    const countParams = [];

    // Add search filter
    if (search) {
        sql += ` AND (d.department_code LIKE ? OR d.department_name LIKE ?)`;
        countSql += ` AND (d.department_code LIKE ? OR d.department_name LIKE ?)`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
        countParams.push(searchTerm, searchTerm);
    }

    // Add ORDER BY department_code
    sql += ` ORDER BY d.department_code ASC`;

    // Add pagination
    sql += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    console.log('📋 SQL:', sql);
    console.log('📋 Params:', params);

    // Execute count query
    db.query(countSql, countParams, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;

        // Execute main query
        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Query error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log(`✅ Found ${results.length} departments, Total: ${total}`);

            res.json({
                success: true,
                data: results,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        });
    });
});
// GET: /api/departments/:id/logo - Get department logo
app.get('/api/departments/:id/logo', (req, res) => {
    const deptId = req.params.id;

    const sql = 'SELECT logo_base64, logo_mime_type FROM departments WHERE department_id = ?';

    db.query(sql, [deptId], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0 || !results[0].logo_base64) {
            return res.status(404).json({
                success: false,
                error: 'Logo not found'
            });
        }

        // Send logo as base64
        const logoData = results[0].logo_base64;
        const mimeType = results[0].logo_mime_type || 'image/png';

        // Extract base64 data
        const base64Data = logoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': buffer.length
        });
        res.end(buffer);
    });
});
// GET: /api/departments/:id - Get single department
app.get('/api/departments/:id', (req, res) => {
    const deptId = req.params.id;

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
        WHERE d.department_id = ?
    `;

    db.query(sql, [deptId], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});
// ============= CATEGORIES API =============
// GET: /api/categories/check-code - Check if code exists
app.get('/api/categories/check-code', (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.json({
            exists: false
        });
    }

    const sql = 'SELECT COUNT(*) as count FROM categories WHERE category_code = ?';

    db.query(sql, [code], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            exists: results[0].count > 0
        });
    });
});

// POST: /api/categories - Create with manual code (updated validation)
app.post('/api/categories', (req, res) => {
    try {
        const catData = req.body;

        console.log('📦 Creating category with code:', catData.category_code);

        // Validation
        const errors = [];

        if (!catData.category_code) {
            errors.push('Category code is required');
        }

        if (!catData.category_name) {
            errors.push('Category name is required');
        }

        if (!catData.department_id) {
            errors.push('Department is required');
        }

        // Validate code format
        if (catData.category_code && !/^[A-Za-z0-9_-]{1,20}$/.test(catData.category_code)) {
            errors.push('Category code format invalid. Use only letters, numbers, dash (-) or underscore (_), max 20 chars.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // Check if code already exists
        const checkSql = 'SELECT category_id FROM categories WHERE category_code = ?';

        db.query(checkSql, [catData.category_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Code check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({ // 409 Conflict
                    success: false,
                    error: `Category code "${catData.category_code}" already exists`
                });
            }

            // Set defaults
            const defaults = {
                discount_percentage: 0.00,
                is_service: false,
                is_active: true,
                created_at: new Date()
            };

            const finalData = { ...defaults, ...catData };

            // Remove undefined
            Object.keys(finalData).forEach(key => {
                if (finalData[key] === undefined) delete finalData[key];
            });

            const insertSql = 'INSERT INTO categories SET ?';

            db.query(insertSql, finalData, (err, result) => {
                if (err) {
                    console.error('❌ Category create error:', err);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }

                res.status(201).json({
                    success: true,
                    message: 'Category created successfully',
                    category_id: result.insertId,
                    category_code: finalData.category_code
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// GET: /api/categories - Get all categories with department info
app.get('/api/categories', (req, res) => {
    const search = req.query.search || '';
    const departmentId = req.query.department_id || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // NEW: Get sort parameter
    const sortBy = req.query.sort_by || 'code'; // 'code', 'name', 'created_at'
    const sortOrder = req.query.sort_order || 'asc'; // 'asc', 'desc'

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
        whereClause += ' AND (c.category_code LIKE ? OR c.category_name LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }

    if (departmentId) {
        whereClause += ' AND c.department_id = ?';
        params.push(departmentId);
    }

    // Get total count
    const countSql = `
        SELECT COUNT(*) as total 
        FROM categories c 
        ${whereClause}
    `;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Determine ORDER BY based on sort parameter
        let orderByClause = 'ORDER BY ';

        switch (sortBy) {
            case 'code':
                orderByClause += `c.category_code ${sortOrder}`;
                break;
            case 'name':
                orderByClause += `c.category_name ${sortOrder}`;
                break;
            case 'created_at':
                orderByClause += `c.created_at ${sortOrder}`;
                break;
            default:
                orderByClause += `c.category_code ${sortOrder}`;
        }

        console.log(`📊 Categories ordering by: ${orderByClause}`);

        // Get data with JOIN to get department name
        const sql = `
            SELECT 
                c.*,
                d.department_code as dept_code,
                d.department_name as dept_name
            FROM categories c
            LEFT JOIN departments d ON c.department_id = d.department_id
            ${whereClause}
            ${orderByClause}
            LIMIT ? OFFSET ?
        `;

        db.query(sql, [...params, limit, offset], (err, results) => {
            if (err) {
                console.error('❌ Categories fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
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
        });
    });
});

// GET: /api/categories/:id - Get single category
app.get('/api/categories/:id', (req, res) => {
    const catId = req.params.id;

    const sql = `
        SELECT 
            c.*,
            d.department_code as dept_code,
            d.department_name as dept_name,
            -- Include logo data in the response
            c.logo_base64,
            c.logo_file_name,
            c.logo_mime_type
        FROM categories c
        LEFT JOIN departments d ON c.department_id = d.department_id
        WHERE c.category_id = ?
    `;

    db.query(sql, [catId], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Category not found'
            });
        }

        const category = results[0];

        // If logo_base64 is very large, you might want to truncate it or handle differently
        // For now, we'll send it as is
        if (category.logo_base64 && category.logo_base64.length > 1000000) { // 1MB
            // Option: Send a thumbnail or just indicate logo exists
            category.logo_base64 = null;
            category.has_large_logo = true;
        }

        res.json({
            success: true,
            data: category
        });
    });
});
// PUT: /api/categories/:id - Update category
app.put('/api/categories/:id', (req, res) => {
    const catId = req.params.id;
    const updateData = req.body;

    console.log(`📝 PUT /api/categories/${catId}`);

    // Check if category exists first
    const checkSql = 'SELECT * FROM categories WHERE category_id = ?';

    db.query(checkSql, [catId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Category ID ${catId} not found`
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Update category
        const updateSql = 'UPDATE categories SET ? WHERE category_id = ?';

        db.query(updateSql, [updateData, catId], (updateErr, result) => {
            if (updateErr) {
                console.error('❌ Update error:', updateErr);
                return res.status(500).json({
                    success: false,
                    error: 'Update failed: ' + updateErr.message
                });
            }

            console.log('✅ Category updated, affected rows:', result.affectedRows);

            res.json({
                success: true,
                message: 'Category updated successfully',
                category_id: catId,
                affectedRows: result.affectedRows
            });
        });
    });
});

// DELETE: /api/categories/:id - Delete category
app.delete('/api/categories/:id', (req, res) => {
    const catId = req.params.id;

    console.log('🗑️ Deleting category:', catId);

    // Check if category exists
    const checkSql = 'SELECT * FROM categories WHERE category_id = ?';

    db.query(checkSql, [catId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Category ID ${catId} not found`
            });
        }

        // Delete category
        const deleteSql = 'DELETE FROM categories WHERE category_id = ?';

        db.query(deleteSql, [catId], (deleteErr, result) => {
            if (deleteErr) {
                console.error('❌ Delete error:', deleteErr);
                return res.status(500).json({
                    success: false,
                    error: 'Delete failed: ' + deleteErr.message
                });
            }

            console.log('✅ Category deleted, affected rows:', result.affectedRows);

            res.json({
                success: true,
                message: 'Category deleted successfully',
                category_id: catId,
                affectedRows: result.affectedRows
            });
        });
    });
});
// GET: /api/departments/active - Get active departments for dropdown
app.get('/api/departments/active', (req, res) => {
    const sql = `
        SELECT department_id, department_code, department_name 
        FROM departments 
        WHERE is_active = 1 
        ORDER BY department_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Active departments error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});
// Add this to your server.js for logo API

// GET: /api/categories/:id/logo - Get category logo
app.get('/api/categories/:id/logo', (req, res) => {
    const catId = req.params.id;

    const sql = 'SELECT logo_base64, logo_mime_type FROM categories WHERE category_id = ?';

    db.query(sql, [catId], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0 || !results[0].logo_base64) {
            return res.status(404).json({
                success: false,
                error: 'Logo not found'
            });
        }

        // Send logo as base64
        const logoData = results[0].logo_base64;
        const mimeType = results[0].logo_mime_type || 'image/png';

        // Extract base64 data
        const base64Data = logoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': buffer.length
        });
        res.end(buffer);
    });
});
// ============= BRANDS API =============

// GET: /api/brands/check-code - Check if brand code exists
app.get('/api/brands/check-code', (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.json({
            exists: false
        });
    }

    const sql = 'SELECT COUNT(*) as count FROM brands WHERE brand_code = ?';

    db.query(sql, [code], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            exists: results[0].count > 0
        });
    });
});

// POST: /api/brands - Create brand
// POST: /api/brands - Create brand (updated validation)
app.post('/api/brands', (req, res) => {
    try {
        const brandData = req.body;

        console.log('📦 Creating brand:', brandData.brand_code);

        // Validation
        const errors = [];

        if (!brandData.brand_code) {
            errors.push('Brand code is required');
        }

        if (!brandData.brand_name) {
            errors.push('Brand name is required');
        }

        // Validate discount
        if (brandData.discount_percentage < 0 || brandData.discount_percentage > 100) {
            errors.push('Discount percentage must be between 0 and 100');
        }

        // Validate code format
        if (brandData.brand_code && !/^[A-Za-z0-9_-]{1,20}$/.test(brandData.brand_code)) {
            errors.push('Brand code format invalid. Use only letters, numbers, dash (-) or underscore (_), max 20 chars.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // Check if code already exists
        const checkSql = 'SELECT brand_id FROM brands WHERE brand_code = ?';

        db.query(checkSql, [brandData.brand_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Code check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Brand code "${brandData.brand_code}" already exists`
                });
            }

            // Set defaults
            const defaults = {
                discount_percentage: 0.00,
                is_active: true,
                created_at: new Date()
            };

            const finalData = { ...defaults, ...brandData };

            // Remove undefined
            Object.keys(finalData).forEach(key => {
                if (finalData[key] === undefined) delete finalData[key];
            });

            const insertSql = 'INSERT INTO brands SET ?';

            db.query(insertSql, finalData, (err, result) => {
                if (err) {
                    console.error('❌ Brand create error:', err);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }

                res.status(201).json({
                    success: true,
                    message: 'Brand created successfully',
                    brand_id: result.insertId,
                    brand_code: finalData.brand_code
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// GET: /api/brands - Get all brands
app.get('/api/brands', (req, res) => {
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
        whereClause += ' AND (brand_code LIKE ? OR brand_name LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }

    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM brands ${whereClause}`;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get data
        const sql = `
            SELECT * FROM brands
            ${whereClause}
            ORDER BY brand_name
            LIMIT ? OFFSET ?
        `;

        db.query(sql, [...params, limit, offset], (err, results) => {
            if (err) {
                console.error('❌ Brands fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});

// GET: /api/brands/:id - Get single brand
app.get('/api/brands/:id', (req, res) => {
    const brandId = req.params.id;

    const sql = 'SELECT * FROM brands WHERE brand_id = ?';

    db.query(sql, [brandId], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Brand not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// PUT: /api/brands/:id - Update brand
app.put('/api/brands/:id', (req, res) => {
    const brandId = req.params.id;
    const updateData = req.body;

    console.log(`📝 PUT /api/brands/${brandId}`);

    // Check if brand exists
    const checkSql = 'SELECT * FROM brands WHERE brand_id = ?';

    db.query(checkSql, [brandId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Brand ID ${brandId} not found`
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Update brand
        const updateSql = 'UPDATE brands SET ? WHERE brand_id = ?';

        db.query(updateSql, [updateData, brandId], (updateErr, result) => {
            if (updateErr) {
                console.error('❌ Update error:', updateErr);
                return res.status(500).json({
                    success: false,
                    error: 'Update failed: ' + updateErr.message
                });
            }

            console.log('✅ Brand updated, affected rows:', result.affectedRows);

            res.json({
                success: true,
                message: 'Brand updated successfully',
                brand_id: brandId,
                affectedRows: result.affectedRows
            });
        });
    });
});

// DELETE: /api/brands/:id - Delete brand
app.delete('/api/brands/:id', (req, res) => {
    const brandId = req.params.id;

    console.log('🗑️ Deleting brand:', brandId);

    // Check if brand exists
    const checkSql = 'SELECT * FROM brands WHERE brand_id = ?';

    db.query(checkSql, [brandId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Brand ID ${brandId} not found`
            });
        }

        // Delete brand
        const deleteSql = 'DELETE FROM brands WHERE brand_id = ?';

        db.query(deleteSql, [brandId], (deleteErr, result) => {
            if (deleteErr) {
                console.error('❌ Delete error:', deleteErr);
                return res.status(500).json({
                    success: false,
                    error: 'Delete failed: ' + deleteErr.message
                });
            }

            console.log('✅ Brand deleted, affected rows:', result.affectedRows);

            res.json({
                success: true,
                message: 'Brand deleted successfully',
                brand_id: brandId,
                affectedRows: result.affectedRows
            });
        });
    });
});

// GET: /api/brands/:id/logo - Get brand logo
app.get('/api/brands/:id/logo', (req, res) => {
    const brandId = req.params.id;

    const sql = 'SELECT logo_base64, logo_mime_type FROM brands WHERE brand_id = ?';

    db.query(sql, [brandId], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0 || !results[0].logo_base64) {
            return res.status(404).json({
                success: false,
                error: 'Logo not found'
            });
        }

        // Send logo as base64
        const logoData = results[0].logo_base64;
        const mimeType = results[0].logo_mime_type || 'image/png';

        const base64Data = logoData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': buffer.length
        });
        res.end(buffer);
    });
});
// ============= UOM API ENDPOINTS =============

// GET: /api/uoms/check-code - Check if UOM code exists
app.get('/api/uoms/check-code', (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.json({ exists: false });
    }

    const sql = 'SELECT COUNT(*) as count FROM uoms WHERE uom_code = ?';

    db.query(sql, [code], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            exists: results[0].count > 0
        });
    });
});

// GET: /api/uoms/base - Get only base UOMs for dropdown
app.get('/api/uoms/base', (req, res) => {
    const sql = `
        SELECT uom_id, uom_code, uom_name 
        FROM uoms 
        WHERE is_base_uom = TRUE 
        AND is_active = TRUE
        ORDER BY uom_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// FIXED API ENDPOINT - Replace the entire /api/uoms function:

// GET: /api/uoms - Get all UOMs with pagination
app.get('/api/uoms', (req, res) => {
    const search = req.query.search || '';
    const is_base = req.query.is_base; // 'true' or 'false'
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
        whereClause += ' AND (u.uom_code LIKE ? OR u.uom_name LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }
    if (is_base === 'true') {
        whereClause += ' AND u.is_base_uom = TRUE';
    } else if (is_base === 'false') {
        whereClause += ' AND u.is_base_uom = FALSE';
    }

    // Get total count - FIXED HERE
    const countSql = `SELECT COUNT(*) as total FROM uoms u ${whereClause}`;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count query error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get data with base UOM info
        const sql = `
            SELECT 
                u.*,
                b.uom_code as base_uom_code,
                b.uom_name as base_uom_name
            FROM uoms u
            LEFT JOIN uoms b ON u.base_uom_id = b.uom_id
            ${whereClause}
            ORDER BY u.is_base_uom DESC, u.uom_name
            LIMIT ? OFFSET ?
        `;

        console.log('📊 SQL Query:', sql);
        console.log('📊 Parameters:', [...params, limit, offset]);

        db.query(sql, [...params, limit, offset], (err, results) => {
            if (err) {
                console.error('❌ Data query error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log('✅ Data fetched:', results.length, 'records');
            console.log('✅ Sample UOM:', results[0] || 'No data');

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages
                }
            });
        });
    });
});

// POST: /api/uoms - Create new UOM
app.post('/api/uoms', (req, res) => {
    console.log('Received data:', req.body);
    try {
        const uomData = req.body;

        // Validation
        const errors = [];

        if (!uomData.uom_code) {
            errors.push('UOM code is required');
        }

        if (!uomData.uom_name) {
            errors.push('UOM name is required');
        }

        // Check format
        if (uomData.uom_code && !/^[A-Z]{1,10}$/.test(uomData.uom_code)) {
            errors.push('UOM code must be uppercase letters only (max 10 chars)');
        }

        // Logic validation
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

        // Check if code exists
        const checkSql = 'SELECT uom_id FROM uoms WHERE uom_code = ?';

        db.query(checkSql, [uomData.uom_code], (checkErr, checkResult) => {
            if (checkErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Database error'
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `UOM code "${uomData.uom_code}" already exists`
                });
            }

            // Set defaults
            const defaults = {
                conversion_factor: 1.0000,
                is_active: true,
                created_at: new Date()
            };

            const finalData = { ...defaults, ...uomData };

            // Clean up data
            if (finalData.is_base_uom) {
                finalData.base_uom_id = null;
                finalData.conversion_factor = 1.0000;
            }

            const insertSql = 'INSERT INTO uoms SET ?';

            db.query(insertSql, finalData, (err, result) => {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }

                res.status(201).json({
                    success: true,
                    message: 'UOM created successfully',
                    uom_id: result.insertId,
                    uom_code: finalData.uom_code
                });
            });
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// GET: /api/uoms/:id - Get single UOM
app.get('/api/uoms/:id', (req, res) => {
    const uomId = req.params.id;

    const sql = `
        SELECT 
            u.*,
            b.uom_code as base_uom_code,
            b.uom_name as base_uom_name
        FROM uoms u
        LEFT JOIN uoms b ON u.base_uom_id = b.uom_id
        WHERE u.uom_id = ?
    `;

    db.query(sql, [uomId], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'UOM not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// PUT: /api/uoms/:id - Update UOM
app.put('/api/uoms/:id', (req, res) => {
    const uomId = req.params.id;
    const updateData = req.body;

    // Check if exists
    const checkSql = 'SELECT * FROM uoms WHERE uom_id = ?';

    db.query(checkSql, [uomId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: 'Database error'
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `UOM not found`
            });
        }

        // Update
        updateData.updated_at = new Date();

        const updateSql = 'UPDATE uoms SET ? WHERE uom_id = ?';

        db.query(updateSql, [updateData, uomId], (updateErr, result) => {
            if (updateErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Update failed'
                });
            }

            res.json({
                success: true,
                message: 'UOM updated successfully'
            });
        });
    });
});


// DELETE: /api/uoms/:id - HARD DELETE (Simple)
app.delete('/api/uoms/:id', (req, res) => {
    const uomId = req.params.id;

    console.log('🗑️ Deleting UOM ID:', uomId);

    // Simple hard delete
    const deleteSql = 'DELETE FROM uoms WHERE uom_id = ?';

    db.query(deleteSql, [uomId], (err, result) => {
        if (err) {
            console.error('❌ Delete error:', err);

            // Check if foreign key constraint error
            if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete! This UOM is being used in the system.'
                });
            }

            return res.status(500).json({
                success: false,
                error: 'Delete failed: ' + err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'UOM not found'
            });
        }

        console.log('✅ UOM deleted successfully');

        res.json({
            success: true,
            message: 'UOM deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});
// ============= PAYMODES API =============

// POST: /api/paymodes - Create paymode
app.post('/api/paymodes', (req, res) => {
    try {
        const paymodeData = req.body;

        console.log('📦 Creating paymode:', paymodeData.paymode_code);

        // Validation
        const errors = [];

        if (!paymodeData.paymode_code || !paymodeData.paymode_code.trim()) {
            errors.push('Paymode code is required');
        }

        if (!paymodeData.paymode_description || !paymodeData.paymode_description.trim()) {
            errors.push('Description is required');
        }

        // Validate code format
        if (paymodeData.paymode_code && !/^[A-Za-z0-9_-]{1,20}$/.test(paymodeData.paymode_code)) {
            errors.push('Paymode code format invalid. Use only letters, numbers, dash (-) or underscore (_), max 20 chars.');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // Check if code already exists
        const checkSql = 'SELECT paymode_id FROM paymodes WHERE paymode_code = ?';

        db.query(checkSql, [paymodeData.paymode_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Code check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Paymode code "${paymodeData.paymode_code}" already exists`
                });
            }

            // If setting as default, unset other defaults
            if (paymodeData.is_default === true) {
                const resetDefaultSql = 'UPDATE paymodes SET is_default = FALSE WHERE is_default = TRUE';
                db.query(resetDefaultSql, (resetErr) => {
                    if (resetErr) {
                        console.warn('Warning: Could not reset default paymodes:', resetErr);
                    }
                });
            }

            // Set defaults
            const defaults = {
                is_bank: false,
                is_default: false,
                is_active: true,
                created_at: new Date()
            };

            const finalData = { ...defaults, ...paymodeData };

            // Insert paymode
            const insertSql = 'INSERT INTO paymodes SET ?';

            db.query(insertSql, finalData, (err, result) => {
                if (err) {
                    console.error('❌ Paymode create error:', err);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }

                res.status(201).json({
                    success: true,
                    message: 'Paymode created successfully',
                    paymode_id: result.insertId,
                    paymode_code: finalData.paymode_code
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// GET: /api/paymodes/check-code - Check if code exists
app.get('/api/paymodes/check-code', (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.json({
            exists: false
        });
    }

    const sql = 'SELECT COUNT(*) as count FROM paymodes WHERE paymode_code = ?';

    db.query(sql, [code], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            exists: results[0].count > 0
        });
    });
});

// GET: /api/paymodes - Get all paymodes with pagination
app.get('/api/paymodes', (req, res) => {
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
        whereClause += ' AND (paymode_code LIKE ? OR paymode_description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }

    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM paymodes ${whereClause}`;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get data
        const sql = `
            SELECT * FROM paymodes 
            ${whereClause}
            ORDER BY 
                is_default DESC,
                paymode_code ASC
            LIMIT ? OFFSET ?
        `;

        db.query(sql, [...params, limit, offset], (err, results) => {
            if (err) {
                console.error('❌ Paymodes fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});
// GET: /api/paymodes/:id - Get single paymode
app.get('/api/paymodes/:id', (req, res) => {
    const paymodeId = req.params.id;

    console.log(`🔍 GET /api/paymodes/${paymodeId}`);

    const sql = `
        SELECT * FROM paymodes 
        WHERE paymode_id = ?
    `;

    db.query(sql, [paymodeId], (err, results) => {
        if (err) {
            console.error('❌ Paymode fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Paymode not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});
// GET: /api/paymodes/active - Get active paymodes for dropdown
app.get('/api/paymodes/active', (req, res) => {
    const sql = `
        SELECT paymode_id, paymode_code, paymode_description, is_bank, is_default 
        FROM paymodes 
        WHERE is_active = 1 
        ORDER BY is_default DESC, paymode_code ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Active paymodes error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});
// ============= PAYMODES API - ADDITIONAL ENDPOINTS =============

// PUT: /api/paymodes/:id - Update paymode
app.put('/api/paymodes/:id', (req, res) => {
    const paymodeId = req.params.id;
    const updateData = req.body;

    console.log(`📝 PUT /api/paymodes/${paymodeId}`, updateData);

    // Check if paymode exists first
    const checkSql = 'SELECT * FROM paymodes WHERE paymode_id = ?';

    db.query(checkSql, [paymodeId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Paymode ID ${paymodeId} not found`
            });
        }

        // If setting as default, unset other defaults
        if (updateData.is_default === true) {
            const resetDefaultSql = 'UPDATE paymodes SET is_default = FALSE WHERE is_default = TRUE AND paymode_id != ?';
            db.query(resetDefaultSql, [paymodeId], (resetErr) => {
                if (resetErr) {
                    console.warn('Warning: Could not reset default paymodes:', resetErr);
                }
            });
        }

        // Add updated timestamp
        updateData.updated_at = new Date();

        // Update paymode
        const updateSql = 'UPDATE paymodes SET ? WHERE paymode_id = ?';

        db.query(updateSql, [updateData, paymodeId], (updateErr, result) => {
            if (updateErr) {
                console.error('❌ Update error:', updateErr);
                return res.status(500).json({
                    success: false,
                    error: 'Update failed: ' + updateErr.message
                });
            }

            console.log('✅ Paymode updated, affected rows:', result.affectedRows);

            res.json({
                success: true,
                message: 'Paymode updated successfully',
                paymode_id: paymodeId,
                affectedRows: result.affectedRows
            });
        });
    });
});

// DELETE: /api/paymodes/:id - Delete paymode
app.delete('/api/paymodes/:id', (req, res) => {
    const paymodeId = req.params.id;

    console.log('🗑️ Deleting paymode:', paymodeId);

    // Check if paymode exists
    const checkSql = 'SELECT * FROM paymodes WHERE paymode_id = ?';

    db.query(checkSql, [paymodeId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Paymode ID ${paymodeId} not found`
            });
        }

        // Check if it's a default paymode
        if (checkResult[0].is_default) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete default paymode. Please set another paymode as default first.'
            });
        }

        // Delete paymode
        const deleteSql = 'DELETE FROM paymodes WHERE paymode_id = ?';

        db.query(deleteSql, [paymodeId], (deleteErr, result) => {
            if (deleteErr) {
                console.error('❌ Delete error:', deleteErr);
                return res.status(500).json({
                    success: false,
                    error: 'Delete failed: ' + deleteErr.message
                });
            }

            console.log('✅ Paymode deleted, affected rows:', result.affectedRows);

            res.json({
                success: true,
                message: 'Paymode deleted successfully',
                paymode_id: paymodeId,
                affectedRows: result.affectedRows
            });
        });
    });
});

// PATCH: /api/paymodes/:id/toggle-default - Toggle default status
app.patch('/api/paymodes/:id/toggle-default', (req, res) => {
    const paymodeId = req.params.id;

    console.log(`🔄 PATCH /api/paymodes/${paymodeId}/toggle-default`);

    // First, check if paymode exists
    const checkSql = 'SELECT * FROM paymodes WHERE paymode_id = ?';

    db.query(checkSql, [paymodeId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: `Paymode ID ${paymodeId} not found`
            });
        }

        // First, unset all defaults
        const resetSql = 'UPDATE paymodes SET is_default = FALSE WHERE is_default = TRUE';

        db.query(resetSql, (resetErr) => {
            if (resetErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to reset defaults: ' + resetErr.message
                });
            }

            // Then set this paymode as default
            const updateSql = 'UPDATE paymodes SET is_default = TRUE, updated_at = ? WHERE paymode_id = ?';

            db.query(updateSql, [new Date(), paymodeId], (updateErr, result) => {
                if (updateErr) {
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to set default: ' + updateErr.message
                    });
                }

                console.log(`✅ Paymode ${paymodeId} set as default`);

                res.json({
                    success: true,
                    message: 'Default paymode updated successfully',
                    paymode_id: paymodeId,
                    affectedRows: result.affectedRows
                });
            });
        });
    });
});
// ============= PROJECTS API =============
// GET: /api/customers/active - Get active customers for dropdown
app.get('/api/customers/active', (req, res) => {
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

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Active customers error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// POST: /api/projects - Create project
app.post('/api/projects', (req, res) => {
    try {
        const projectData = req.body;

        console.log('📦 Creating project:', projectData.project_code);

        // Validation
        const errors = [];

        if (!projectData.project_code) {
            errors.push('Project code is required');
        }

        if (!projectData.project_name) {
            errors.push('Project name is required');
        }

        if (!projectData.customer_id) {
            errors.push('Customer is required');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // Check if project code already exists
        const checkSql = 'SELECT project_id FROM projects WHERE project_code = ?';

        db.query(checkSql, [projectData.project_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Code check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Project code "${projectData.project_code}" already exists`
                });
            }

            // Set defaults
            const defaults = {
                project_status: 'On going',
                is_active: true,
                created_at: new Date()
            };

            const finalData = { ...defaults, ...projectData };

            // Remove undefined
            Object.keys(finalData).forEach(key => {
                if (finalData[key] === undefined) delete finalData[key];
            });

            const insertSql = 'INSERT INTO projects SET ?';

            db.query(insertSql, finalData, (err, result) => {
                if (err) {
                    console.error('❌ Project create error:', err);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }

                res.status(201).json({
                    success: true,
                    message: 'Project created successfully',
                    project_id: result.insertId,
                    project_code: finalData.project_code
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// PUT: /api/projects/:id - Update project
app.put('/api/projects/:id', (req, res) => {
    const projectId = req.params.id;
    const updateData = req.body;

    console.log(`✏️ Updating project ${projectId}:`, updateData);

    // Validation
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

    const sql = 'UPDATE projects SET ? WHERE project_id = ?';

    db.query(sql, [updateData, projectId], (err, result) => {
        if (err) {
            console.error('❌ Project update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        res.json({
            success: true,
            message: 'Project updated successfully',
            affectedRows: result.affectedRows
        });
    });
});
// GET: /api/projects/:id - Get single project details
// Updated API endpoint with better error logging:
// GET: /api/projects/:id - Get single project details (FIXED VERSION)
app.get('/api/projects/:id', (req, res) => {
    const projectId = req.params.id;
    console.log(`🔍 Fetching project ID: ${projectId}`);

    const sql = `
        SELECT 
            p.*,
            c.customer_code,
            c.customer_name,
            c.contact_person1,
            c.phone1,
            c.email,
            -- c.address, -- REMOVED THIS LINE
            DATE_FORMAT(p.start_date, '%d-%m-%Y') as formatted_start_date,
            DATE_FORMAT(p.end_date, '%d-%m-%Y') as formatted_end_date,
            DATE_FORMAT(p.created_at, '%d-%m-%Y %H:%i') as formatted_created_at,
            DATE_FORMAT(p.updated_at, '%d-%m-%Y %H:%i') as formatted_updated_at
        FROM projects p
        LEFT JOIN customers c ON p.customer_id = c.customer_id
        WHERE p.project_id = ?
    `;

    db.query(sql, [projectId], (err, results) => {
        if (err) {
            console.error('❌ SQL Error:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// GET: /api/projects - Get all projects with customer info
// server.js - Add more filter options
app.get('/api/projects', (req, res) => {
    const search = req.query.search || '';
    const customerId = req.query.customer_id || '';
    const status = req.query.status || '';
    const isActive = req.query.is_active; // true/false
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
        whereClause += ' AND (p.project_code LIKE ? OR p.project_name LIKE ? OR c.customer_name LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (customerId) {
        whereClause += ' AND p.customer_id = ?';
        params.push(customerId);
    }

    if (status && status !== 'All') {
        whereClause += ' AND p.project_status = ?';
        params.push(status);
    }

    if (isActive !== undefined && isActive !== '') {
        whereClause += ' AND p.is_active = ?';
        params.push(isActive === 'true');
    }

    // Get total count
    const countSql = `
        SELECT COUNT(*) as total 
        FROM projects p 
        LEFT JOIN customers c ON p.customer_id = c.customer_id
        ${whereClause}
    `;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get data with JOIN to get customer info
        const sql = `
    SELECT 
        p.*,
        c.customer_code,
        c.customer_name,
        c.contact_person1,
        c.phone1,
        c.email,
        DATE_FORMAT(p.start_date, '%d-%m-%Y') as formatted_start_date,
        DATE_FORMAT(p.created_at, '%d-%m-%Y %H:%i') as formatted_created_date,  -- Added time
        DATE_FORMAT(p.created_at, '%d-%m-%Y') as created_date_only,             -- Date only
        DATE_FORMAT(p.created_at, '%H:%i') as created_time_only                -- Time only
    FROM projects p
    LEFT JOIN customers c ON p.customer_id = c.customer_id
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
`;

        db.query(sql, [...params, limit, offset], (err, results) => {
            if (err) {
                console.error('❌ Projects fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});
// DELETE: /api/projects/:id - Hard delete project
app.delete('/api/projects/:id', (req, res) => {
    const projectId = req.params.id;

    console.log(`🗑️ Hard deleting project ID: ${projectId}`);

    // First, check if project exists
    const checkSql = 'SELECT project_code FROM projects WHERE project_id = ?';

    db.query(checkSql, [projectId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }

        const projectCode = checkResult[0].project_code;

        // Optional: Check if project has related records (like invoices, tasks, etc.)
        // const checkRelatedSql = 'SELECT COUNT(*) as count FROM invoices WHERE project_id = ?';
        // Implement if you have related tables

        // Perform hard delete
        const deleteSql = 'DELETE FROM projects WHERE project_id = ?';

        db.query(deleteSql, [projectId], (err, result) => {
            if (err) {
                console.error('❌ Delete error:', err);

                // Check if it's a foreign key constraint error
                if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
                    return res.status(409).json({
                        success: false,
                        error: `Cannot delete project "${projectCode}" because it has related records. Please delete related records first or use soft delete.`
                    });
                }

                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Project not found'
                });
            }

            console.log(`✅ Hard deleted project: ${projectCode}`);

            res.json({
                success: true,
                message: `Project "${projectCode}" permanently deleted`,
                deleted_id: projectId,
                deleted_code: projectCode
            });
        });
    });
});

// ============= LOCATIONS API =============

// 1. GET: Check if location code exists
app.get('/api/locations/check-code/:code', (req, res) => {
    const locationCode = req.params.code;

    console.log('🔍 Checking location code:', locationCode);

    if (!locationCode) {
        return res.json({
            success: true,
            exists: false
        });
    }

    const sql = 'SELECT location_id FROM locations WHERE location_code = ?';

    db.query(sql, [locationCode], (err, results) => {
        if (err) {
            console.error('❌ Check code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            exists: results.length > 0
        });
    });
});

// 2. GET: Get next available sort code
app.get('/api/locations/next-sort-code', (req, res) => {
    console.log('🔢 Getting next sort code...');

    const sql = 'SELECT COALESCE(MAX(sort_code), 0) + 1 as next_sort_code FROM locations';

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Next sort code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log('✅ Next sort code:', results[0].next_sort_code);

        res.json({
            success: true,
            next_sort_code: results[0].next_sort_code
        });
    });
});

// 3. POST: Create new location
app.post('/api/locations', (req, res) => {
    const locationData = req.body;

    console.log('📝 Creating location:', locationData.location_code);

    // Validation
    const errors = [];

    if (!locationData.location_code) {
        errors.push('Location code is required');
    }

    if (!locationData.location_name) {
        errors.push('Location name is required');
    }

    if (!locationData.sort_code) {
        errors.push('Sort code is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: errors.join(', ')
        });
    }

    // Check if location code already exists
    const checkCodeSql = 'SELECT location_id FROM locations WHERE location_code = ?';

    db.query(checkCodeSql, [locationData.location_code], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Code check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Location code "${locationData.location_code}" already exists`
            });
        }

        // Check if sort code already exists
        const checkSortSql = 'SELECT location_id FROM locations WHERE sort_code = ?';

        db.query(checkSortSql, [locationData.sort_code], (sortErr, sortResult) => {
            if (sortErr) {
                console.error('❌ Sort code check error:', sortErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + sortErr.message
                });
            }

            if (sortResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Sort code "${locationData.sort_code}" already exists. Please use a different sort code.`
                });
            }

            // Set defaults
            locationData.created_at = new Date();
            locationData.created_by = locationData.created_by || 1; // From session

            // Ensure time format (HH:MM:SS)
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

            // Remove undefined values
            Object.keys(locationData).forEach(key => {
                if (locationData[key] === undefined) delete locationData[key];
            });

            // Insert location
            const insertSql = 'INSERT INTO locations SET ?';

            db.query(insertSql, locationData, (insertErr, result) => {
                if (insertErr) {
                    console.error('❌ Location create error:', insertErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create location: ' + insertErr.message
                    });
                }

                console.log('✅ Location created, ID:', result.insertId);

                res.status(201).json({
                    success: true,
                    message: 'Location created successfully',
                    location_id: result.insertId,
                    location_code: locationData.location_code,
                    sort_code: locationData.sort_code
                });
            });
        });
    });
});

// 4. GET: List all locations (for list page)
app.get('/api/locations', (req, res) => {
    const {
        search = '',
        page = 1,
        limit = 20,
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching locations:', { search, page, limit, status });

    let sql = 'SELECT * FROM locations WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (location_code LIKE ? OR location_name LIKE ? OR address LIKE ? OR city LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND is_active = FALSE';
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY sort_code ASC, location_name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Locations fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});

// 5. GET: Single location details
app.get('/api/locations/:id', (req, res) => {
    const locationId = req.params.id;

    console.log('🔍 Getting location:', locationId);

    const sql = 'SELECT * FROM locations WHERE location_id = ?';

    db.query(sql, [locationId], (err, results) => {
        if (err) {
            console.error('❌ Location fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// 6. PUT: Update location
app.put('/api/locations/:id', (req, res) => {
    const locationId = req.params.id;
    const updateData = req.body;

    console.log('📝 Updating location:', locationId);

    // Update timestamp
    updateData.updated_at = new Date();

    const sql = 'UPDATE locations SET ? WHERE location_id = ?';

    db.query(sql, [updateData, locationId], (err, result) => {
        if (err) {
            console.error('❌ Location update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            message: 'Location updated successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 7. DELETE: Delete location
app.delete('/api/locations/:id', (req, res) => {
    const locationId = req.params.id;

    console.log('🗑️ Deleting location:', locationId);

    const sql = 'DELETE FROM locations WHERE location_id = ?';

    db.query(sql, [locationId], (err, result) => {
        if (err) {
            console.error('❌ Location delete error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Location not found'
            });
        }

        res.json({
            success: true,
            message: 'Location deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 8. GET: Test endpoint
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

// 1. GET: Get next available sort code for department
app.get('/api/department/next-sort-code', (req, res) => {
    console.log('🔢 Getting next sort code for department...');

    const sql = 'SELECT COALESCE(MAX(sort_code), 0) + 1 as next_sort_code FROM department';

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Next sort code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log('✅ Next department sort code:', results[0].next_sort_code);

        res.json({
            success: true,
            next_sort_code: results[0].next_sort_code
        });
    });
});
app.get('/api/department/check-code/:code', (req, res) => {
    const deptCode = req.params.code;

    console.log('🔍 Checking department code:', deptCode);

    const sql = 'SELECT department_id FROM department WHERE department_code = ?';

    db.query(sql, [deptCode], (err, results) => {
        if (err) {
            console.error('❌ Check code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            exists: results.length > 0
        });
    });
});

// 2. POST: Create new department
app.post('/api/department', (req, res) => {
    const departmentData = req.body;

    console.log('📝 Creating department:', departmentData.department_code);

    // Validation
    const errors = [];

    if (!departmentData.department_code) {
        errors.push('Department code is required');
    }

    if (!departmentData.department_name) {
        errors.push('Department name is required');
    }

    if (!departmentData.sort_code) {
        errors.push('Sort code is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: errors.join(', ')
        });
    }

    // Check if department code already exists
    const checkCodeSql = 'SELECT department_id FROM department WHERE department_code = ?';

    db.query(checkCodeSql, [departmentData.department_code], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Code check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Department code "${departmentData.department_code}" already exists`
            });
        }

        // Check if sort code already exists
        const checkSortSql = 'SELECT department_id FROM department WHERE sort_code = ?';

        db.query(checkSortSql, [departmentData.sort_code], (sortErr, sortResult) => {
            if (sortErr) {
                console.error('❌ Sort code check error:', sortErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + sortErr.message
                });
            }

            if (sortResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Sort code "${departmentData.sort_code}" already exists. Please use a different sort code.`
                });
            }

            // Set defaults
            departmentData.created_at = new Date();
            departmentData.created_by = departmentData.created_by || 1;

            // Ensure time format (HH:MM:SS)
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

            // Remove undefined values
            Object.keys(departmentData).forEach(key => {
                if (departmentData[key] === undefined) delete departmentData[key];
            });

            // Insert department
            const insertSql = 'INSERT INTO department SET ?';

            db.query(insertSql, departmentData, (insertErr, result) => {
                if (insertErr) {
                    console.error('❌ Department create error:', insertErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create department: ' + insertErr.message
                    });
                }

                console.log('✅ Department created, ID:', result.insertId);

                res.status(201).json({
                    success: true,
                    message: 'Department created successfully',
                    department_id: result.insertId,
                    department_code: departmentData.department_code,
                    sort_code: departmentData.sort_code
                });
            });
        });
    });
});
app.get('/api/department', (req, res) => {
    const {
        search = '',
        page = 1,
        limit = 20,
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching departments:', { search, page, limit, status });

    let sql = 'SELECT * FROM department WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (department_code LIKE ? OR department_name LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND is_active = FALSE';
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY sort_code ASC, department_name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Departments fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});
// GET: Single department details
app.get('/api/department/:id', (req, res) => {
    const departmentId = req.params.id;

    console.log('🔍 Getting department by ID:', departmentId);

    const sql = 'SELECT * FROM department WHERE department_id = ?';

    db.query(sql, [departmentId], (err, results) => {
        if (err) {
            console.error('❌ Department fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// PUT: Update department
app.put('/api/department/:id', (req, res) => {
    const departmentId = req.params.id;
    const updateData = req.body;

    console.log('📝 Updating department:', departmentId);

    // Update timestamp
    updateData.updated_at = new Date();

    const sql = 'UPDATE department SET ? WHERE department_id = ?';

    db.query(sql, [updateData, departmentId], (err, result) => {
        if (err) {
            console.error('❌ Department update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        res.json({
            success: true,
            message: 'Department updated successfully',
            affectedRows: result.affectedRows
        });
    });
});
// 3. DELETE: Delete department
app.delete('/api/department/:id', (req, res) => {
    const departmentId = req.params.id;

    console.log('🗑️ Deleting department:', departmentId);

    const sql = 'DELETE FROM department WHERE department_id = ?';

    db.query(sql, [departmentId], (err, result) => {
        if (err) {
            console.error('❌ Department delete error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Department not found'
            });
        }

        res.json({
            success: true,
            message: 'Department deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});
// ============= EMPLOYEE TYPES API =============

// 1. GET: Get next available hierarchy code
app.get('/api/employee-types/next-hierarchy-code', (req, res) => {
    console.log('🔢 Getting next hierarchy code...');

    const sql = 'SELECT COALESCE(MAX(hierarchy_code), 0) + 1 as next_hierarchy_code FROM employee_types';

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Next hierarchy code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log('✅ Next hierarchy code:', results[0].next_hierarchy_code);

        res.json({
            success: true,
            next_hierarchy_code: results[0].next_hierarchy_code
        });
    });
});

// 2. POST: Create new employee type
app.post('/api/employee-types', (req, res) => {
    const employeeTypeData = req.body;

    console.log('📝 Creating employee type:', employeeTypeData.type_code);

    // Validation
    const errors = [];

    if (!employeeTypeData.type_code) {
        errors.push('Type code is required');
    }

    if (!employeeTypeData.description) {
        errors.push('Description is required');
    }

    if (!employeeTypeData.hierarchy_code) {
        errors.push('Hierarchy code is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: errors.join(', ')
        });
    }

    // Check if type code already exists
    const checkCodeSql = 'SELECT type_id FROM employee_types WHERE type_code = ?';

    db.query(checkCodeSql, [employeeTypeData.type_code], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Type code check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Employee type code "${employeeTypeData.type_code}" already exists`
            });
        }

        // Check if hierarchy code already exists
        const checkHierarchySql = 'SELECT type_id FROM employee_types WHERE hierarchy_code = ?';

        db.query(checkHierarchySql, [employeeTypeData.hierarchy_code], (hierarchyErr, hierarchyResult) => {
            if (hierarchyErr) {
                console.error('❌ Hierarchy code check error:', hierarchyErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + hierarchyErr.message
                });
            }

            if (hierarchyResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Hierarchy code "${employeeTypeData.hierarchy_code}" already exists. Please use a different hierarchy code.`
                });
            }

            // Set defaults
            employeeTypeData.created_at = new Date();
            employeeTypeData.created_by = employeeTypeData.created_by || 1; // From session

            // Remove undefined values
            Object.keys(employeeTypeData).forEach(key => {
                if (employeeTypeData[key] === undefined) delete employeeTypeData[key];
            });

            // Insert employee type
            const insertSql = 'INSERT INTO employee_types SET ?';

            db.query(insertSql, employeeTypeData, (insertErr, result) => {
                if (insertErr) {
                    console.error('❌ Employee type create error:', insertErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create employee type: ' + insertErr.message
                    });
                }

                console.log('✅ Employee type created, ID:', result.insertId);

                res.status(201).json({
                    success: true,
                    message: 'Employee type created successfully',
                    type_id: result.insertId,
                    type_code: employeeTypeData.type_code,
                    hierarchy_code: employeeTypeData.hierarchy_code
                });
            });
        });
    });
});

// 3. GET: List all employee types
app.get('/api/employee-types', (req, res) => {
    const {
        search = '',
        page = 1,
        limit = 20,
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching employee types:', { search, page, limit, status });

    let sql = 'SELECT * FROM employee_types WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (type_code LIKE ? OR description LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND is_active = FALSE';
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY hierarchy_code ASC, type_code ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Employee types fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});

// 4. GET: Single employee type details
app.get('/api/employee-types/:id', (req, res) => {
    const typeId = req.params.id;

    console.log('🔍 Getting employee type:', typeId);

    const sql = 'SELECT * FROM employee_types WHERE type_id = ?';

    db.query(sql, [typeId], (err, results) => {
        if (err) {
            console.error('❌ Employee type fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Employee type not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// 5. PUT: Update employee type
app.put('/api/employee-types/:id', (req, res) => {
    const typeId = req.params.id;
    const updateData = req.body;

    console.log('📝 Updating employee type:', typeId);

    // Update timestamp
    updateData.updated_at = new Date();

    const sql = 'UPDATE employee_types SET ? WHERE type_id = ?';

    db.query(sql, [updateData, typeId], (err, result) => {
        if (err) {
            console.error('❌ Employee type update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Employee type not found'
            });
        }

        res.json({
            success: true,
            message: 'Employee type updated successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 6. DELETE: Delete employee type
app.delete('/api/employee-types/:id', (req, res) => {
    const typeId = req.params.id;

    console.log('🗑️ Deleting employee type:', typeId);

    const sql = 'DELETE FROM employee_types WHERE type_id = ?';

    db.query(sql, [typeId], (err, result) => {
        if (err) {
            console.error('❌ Employee type delete error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Employee type not found'
            });
        }

        res.json({
            success: true,
            message: 'Employee type deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 7. GET: Check if type code exists
app.get('/api/employee-types/check-code/:code', (req, res) => {
    const typeCode = req.params.code;

    console.log('🔍 Checking employee type code:', typeCode);

    if (!typeCode) {
        return res.json({
            success: true,
            exists: false
        });
    }

    const sql = 'SELECT type_id FROM employee_types WHERE type_code = ?';

    db.query(sql, [typeCode], (err, results) => {
        if (err) {
            console.error('❌ Check code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            exists: results.length > 0
        });
    });
});
// ============= LOAN TYPES API =============

// 1. POST: Create new loan type
app.post('/api/loan-types', (req, res) => {
    const loanTypeData = req.body;

    console.log('📝 Creating loan type:', loanTypeData.loan_code);

    // Validation
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

    // Check if loan code already exists
    const checkCodeSql = 'SELECT loan_type_id FROM loan_types WHERE loan_code = ?';

    db.query(checkCodeSql, [loanTypeData.loan_code.trim()], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Loan code check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Loan code "${loanTypeData.loan_code}" already exists`
            });
        }

        // Set defaults
        loanTypeData.created_at = new Date();
        loanTypeData.created_by = loanTypeData.created_by || 1; // From session
        loanTypeData.loan_code = loanTypeData.loan_code.trim().toUpperCase();
        loanTypeData.description = loanTypeData.description.trim();

        // Remove undefined values
        Object.keys(loanTypeData).forEach(key => {
            if (loanTypeData[key] === undefined) delete loanTypeData[key];
        });

        // Insert loan type
        const insertSql = 'INSERT INTO loan_types SET ?';

        db.query(insertSql, loanTypeData, (insertErr, result) => {
            if (insertErr) {
                console.error('❌ Loan type create error:', insertErr);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create loan type: ' + insertErr.message
                });
            }

            console.log('✅ Loan type created, ID:', result.insertId);

            res.status(201).json({
                success: true,
                message: 'Loan type created successfully',
                loan_type_id: result.insertId,
                loan_code: loanTypeData.loan_code,
                description: loanTypeData.description
            });
        });
    });
});

// 2. GET: List all loan types
app.get('/api/loan-types', (req, res) => {
    const {
        search = '',
        page = 1,
        limit = 20,
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching loan types:', { search, page, limit, status });

    let sql = 'SELECT * FROM loan_types WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (loan_code LIKE ? OR description LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND is_active = FALSE';
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY loan_code ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Loan types fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});

// 3. GET: Single loan type details
app.get('/api/loan-types/:id', (req, res) => {
    const loanTypeId = req.params.id;

    console.log('🔍 Getting loan type:', loanTypeId);

    const sql = 'SELECT * FROM loan_types WHERE loan_type_id = ?';

    db.query(sql, [loanTypeId], (err, results) => {
        if (err) {
            console.error('❌ Loan type fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Loan type not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// 4. PUT: Update loan type
app.put('/api/loan-types/:id', (req, res) => {
    const loanTypeId = req.params.id;
    const updateData = req.body;

    console.log('📝 Updating loan type:', loanTypeId);

    // Update timestamp
    updateData.updated_at = new Date();

    // Clean data
    if (updateData.loan_code) updateData.loan_code = updateData.loan_code.trim().toUpperCase();
    if (updateData.description) updateData.description = updateData.description.trim();

    const sql = 'UPDATE loan_types SET ? WHERE loan_type_id = ?';

    db.query(sql, [updateData, loanTypeId], (err, result) => {
        if (err) {
            console.error('❌ Loan type update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Loan type not found'
            });
        }

        res.json({
            success: true,
            message: 'Loan type updated successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 5. DELETE: Delete loan type
app.delete('/api/loan-types/:id', (req, res) => {
    const loanTypeId = req.params.id;

    console.log('🗑️ Deleting loan type:', loanTypeId);

    const sql = 'DELETE FROM loan_types WHERE loan_type_id = ?';

    db.query(sql, [loanTypeId], (err, result) => {
        if (err) {
            console.error('❌ Loan type delete error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Loan type not found'
            });
        }

        res.json({
            success: true,
            message: 'Loan type deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 6. GET: Check if loan code exists
app.get('/api/loan-types/check-code/:code', (req, res) => {
    const loanCode = req.params.code.toUpperCase();

    console.log('🔍 Checking loan code:', loanCode);

    if (!loanCode) {
        return res.json({
            success: true,
            exists: false
        });
    }

    const sql = 'SELECT loan_type_id FROM loan_types WHERE loan_code = ?';

    db.query(sql, [loanCode], (err, results) => {
        if (err) {
            console.error('❌ Check code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            exists: results.length > 0
        });
    });
});

// 7. GET: Get active loan types (for dropdowns)
app.get('/api/loan-types/active', (req, res) => {
    console.log('📋 Getting active loan types for dropdown...');

    const sql = 'SELECT loan_type_id, loan_code, description FROM loan_types WHERE is_active = TRUE ORDER BY loan_code ASC';

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Active loan types error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});
// ============= PUBLIC HOLIDAYS API =============

// 1. GET: Check if holiday code exists
app.get('/api/public-holidays/check-code/:code', (req, res) => {
    const holidayCode = req.params.code;

    console.log('🔍 Checking holiday code:', holidayCode);

    if (!holidayCode) {
        return res.json({ success: true, exists: false });
    }

    const sql = 'SELECT holiday_id FROM public_holidays WHERE holiday_code = ?';

    db.query(sql, [holidayCode], (err, results) => {
        if (err) {
            console.error('❌ Check holiday code error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        res.json({ success: true, exists: results.length > 0 });
    });
});

// 2. POST: Create new public holiday
app.post('/api/public-holidays', (req, res) => {
    const holidayData = req.body;

    console.log('📝 Creating public holiday:', holidayData.holiday_code);

    // Validation
    const errors = [];

    if (!holidayData.holiday_code) errors.push('Holiday code is required');
    if (!holidayData.description) errors.push('Description is required');
    if (!holidayData.actual_date) errors.push('Actual date is required');
    if (!holidayData.leave_date) errors.push('Leave date is required');

    if (errors.length > 0) {
        return res.status(400).json({ success: false, error: errors.join(', ') });
    }

    // Check if holiday code exists
    const checkCodeSql = 'SELECT holiday_id FROM public_holidays WHERE holiday_code = ?';

    db.query(checkCodeSql, [holidayData.holiday_code], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Code check error:', checkErr);
            return res.status(500).json({ success: false, error: 'Database error: ' + checkErr.message });
        }

        if (checkResult.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Holiday code "${holidayData.holiday_code}" already exists`
            });
        }

        // Set defaults
        holidayData.created_at = new Date();
        holidayData.created_by = holidayData.created_by || 1; // From session

        // Convert location to NULL if empty
        if (holidayData.location_id === '') {
            holidayData.location_id = null;
        }

        // Convert boolean values
        holidayData.is_recurring = holidayData.is_recurring ? 1 : 0;
        holidayData.is_national = holidayData.is_national ? 1 : 0;

        // Insert holiday
        const insertSql = 'INSERT INTO public_holidays SET ?';

        db.query(insertSql, holidayData, (insertErr, result) => {
            if (insertErr) {
                console.error('❌ Holiday create error:', insertErr);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create holiday: ' + insertErr.message
                });
            }

            console.log('✅ Holiday created, ID:', result.insertId);

            res.status(201).json({
                success: true,
                message: 'Public holiday created successfully',
                holiday_id: result.insertId,
                holiday_code: holidayData.holiday_code
            });
        });
    });
});

// 3. GET: List all public holidays
app.get('/api/public-holidays', (req, res) => {
    const {
        year = new Date().getFullYear(),
        search = '',
        page = 1,
        limit = 20,
        location_id = ''
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching public holidays:', { year, search, page, limit, location_id });

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
        WHERE YEAR(ph.leave_date) = ?
    `;

    const params = [year];

    // Search filter
    if (search) {
        sql += ' AND (ph.holiday_code LIKE ? OR ph.description LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    // Location filter
    if (location_id) {
        sql += ' AND (ph.location_id = ? OR ph.location_id IS NULL)';
        params.push(location_id);
    }

    // Get total count
    const countSql = sql.replace('SELECT ph.*, l.location_name, l.location_code, CASE WHEN ph.location_id IS NULL THEN \'All Locations\' ELSE l.location_name END as applicable_location', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({ success: false, error: countErr.message });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY ph.leave_date ASC, ph.holiday_code ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Holidays fetch error:', err);
                return res.status(500).json({ success: false, error: err.message });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});

// 4. GET: Get locations for dropdown
app.get('/api/public-holidays/locations', (req, res) => {
    const sql = 'SELECT location_id, location_code, location_name FROM locations WHERE is_active = TRUE ORDER BY location_name ASC';

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Locations fetch error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        res.json({
            success: true,
            data: results
        });
    });
});

// 5. DELETE: Delete holiday
app.delete('/api/public-holidays/:id', (req, res) => {
    const holidayId = req.params.id;

    console.log('🗑️ Deleting holiday:', holidayId);

    const sql = 'DELETE FROM public_holidays WHERE holiday_id = ?';

    db.query(sql, [holidayId], (err, result) => {
        if (err) {
            console.error('❌ Holiday delete error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Holiday not found' });
        }

        res.json({
            success: true,
            message: 'Holiday deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});
app.get('/api/public-holidays/:id', (req, res) => {
    const holidayId = req.params.id;

    console.log('🔍 Getting holiday:', holidayId);

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
        WHERE ph.holiday_id = ?
    `;

    db.query(sql, [holidayId], (err, results) => {
        if (err) {
            console.error('❌ Holiday fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});
app.put('/api/public-holidays/:id', (req, res) => {
    const holidayId = req.params.id;
    const updateData = req.body;

    console.log('📝 Updating holiday:', holidayId);

    // Update timestamp
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

    const sql = 'UPDATE public_holidays SET ? WHERE holiday_id = ?';

    db.query(sql, [updateData, holidayId], (err, result) => {
        if (err) {
            console.error('❌ Holiday update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Holiday not found'
            });
        }

        res.json({
            success: true,
            message: 'Holiday updated successfully',
            affectedRows: result.affectedRows
        });
    });
});
app.get('/api/public-holidays/filter', (req, res) => {
    const { type, year, location_id } = req.query;

    let sql = 'SELECT * FROM public_holidays WHERE 1=1';
    const params = [];

    if (type) {
        sql += ' AND holiday_type = ?';
        params.push(type);
    }

    if (year) {
        sql += ' AND YEAR(leave_date) = ?';
        params.push(year);
    }

    if (location_id) {
        sql += ' AND (location_id = ? OR location_id IS NULL)';
        params.push(location_id);
    }

    sql += ' ORDER BY leave_date ASC';

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('❌ Filter error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
// ============= OT TYPES API =============

// 1. GET: Get next available sort code for OT Types
app.get('/api/ot-types/next-sort-code', (req, res) => {
    console.log('🔢 Getting next OT type sort code...');

    const sql = 'SELECT COALESCE(MAX(sort_code), 0) + 1 as next_sort_code FROM ot_types';

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ OT Type sort code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log('✅ Next OT type sort code:', results[0].next_sort_code);

        res.json({
            success: true,
            next_sort_code: results[0].next_sort_code
        });
    });
});

// 2. GET: Check if OT type code exists
app.get('/api/ot-types/check-code/:code', (req, res) => {
    const otTypeCode = req.params.code;

    console.log('🔍 Checking OT type code:', otTypeCode);

    if (!otTypeCode) {
        return res.json({
            success: true,
            exists: false
        });
    }

    const sql = 'SELECT ot_type_id FROM ot_types WHERE ot_type_code = ?';

    db.query(sql, [otTypeCode], (err, results) => {
        if (err) {
            console.error('❌ Check OT type code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            exists: results.length > 0
        });
    });
});

// 3. POST: Create new OT type
app.post('/api/ot-types', (req, res) => {
    const otTypeData = req.body;

    console.log('📝 Creating OT type:', otTypeData.ot_type_code);

    // Validation
    const errors = [];

    if (!otTypeData.ot_type_code) {
        errors.push('OT type code is required');
    }

    if (!otTypeData.ot_type_name) {
        errors.push('OT type name is required');
    }

    if (!otTypeData.sort_code) {
        errors.push('Sort code is required');
    }

    if (otTypeData.min_hours_for_break === undefined || otTypeData.min_hours_for_break === null) {
        errors.push('Minimum hours for break is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: errors.join(', ')
        });
    }

    // Check if OT type code already exists
    const checkCodeSql = 'SELECT ot_type_id FROM ot_types WHERE ot_type_code = ?';

    db.query(checkCodeSql, [otTypeData.ot_type_code], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Code check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length > 0) {
            return res.status(409).json({
                success: false,
                error: `OT type code "${otTypeData.ot_type_code}" already exists`
            });
        }

        // Check if sort code already exists
        const checkSortSql = 'SELECT ot_type_id FROM ot_types WHERE sort_code = ?';

        db.query(checkSortSql, [otTypeData.sort_code], (sortErr, sortResult) => {
            if (sortErr) {
                console.error('❌ Sort code check error:', sortErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + sortErr.message
                });
            }

            if (sortResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Sort code "${otTypeData.sort_code}" already exists. Please use a different sort code.`
                });
            }

            // Set defaults
            otTypeData.created_at = new Date();
            otTypeData.created_by = otTypeData.created_by || 1; // From session

            // Remove undefined values
            Object.keys(otTypeData).forEach(key => {
                if (otTypeData[key] === undefined) delete otTypeData[key];
            });

            // Insert OT type
            const insertSql = 'INSERT INTO ot_types SET ?';

            db.query(insertSql, otTypeData, (insertErr, result) => {
                if (insertErr) {
                    console.error('❌ OT type create error:', insertErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create OT type: ' + insertErr.message
                    });
                }

                console.log('✅ OT type created, ID:', result.insertId);

                res.status(201).json({
                    success: true,
                    message: 'OT type created successfully',
                    ot_type_id: result.insertId,
                    ot_type_code: otTypeData.ot_type_code,
                    sort_code: otTypeData.sort_code
                });
            });
        });
    });
});

// 4. GET: List all OT types
app.get('/api/ot-types', (req, res) => {
    const {
        search = '',
        page = 1,
        limit = 20,
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching OT types:', { search, page, limit, status });

    let sql = 'SELECT * FROM ot_types WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (ot_type_code LIKE ? OR ot_type_name LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND is_active = FALSE';
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY sort_code ASC, ot_type_name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ OT types fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});

// 5. GET: Single OT type details
app.get('/api/ot-types/:id', (req, res) => {
    const otTypeId = req.params.id;

    console.log('🔍 Getting OT type:', otTypeId);

    const sql = 'SELECT * FROM ot_types WHERE ot_type_id = ?';

    db.query(sql, [otTypeId], (err, results) => {
        if (err) {
            console.error('❌ OT type fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'OT type not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// 6. PUT: Update OT type
// 6. PUT: Update OT type (Enhanced for edit)
app.put('/api/ot-types/:id', (req, res) => {
    const otTypeId = req.params.id;
    const updateData = req.body;

    console.log('📝 Updating OT type:', otTypeId);

    // Validation
    const errors = [];

    if (updateData.sort_code) {
        // Check if sort code already exists (excluding current OT type)
        const checkSortSql = 'SELECT ot_type_id FROM ot_types WHERE sort_code = ? AND ot_type_id != ?';

        db.query(checkSortSql, [updateData.sort_code, otTypeId], (sortErr, sortResult) => {
            if (sortErr) {
                console.error('❌ Sort code check error:', sortErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + sortErr.message
                });
            }

            if (sortResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Sort code "${updateData.sort_code}" already exists. Please use a different sort code.`
                });
            }

            // Continue with update
            proceedWithUpdate();
        });
    } else {
        proceedWithUpdate();
    }

    function proceedWithUpdate() {
        // Update timestamp
        updateData.updated_at = new Date();
        updateData.updated_by = updateData.updated_by || 1; // From session

        const sql = 'UPDATE ot_types SET ? WHERE ot_type_id = ?';

        db.query(sql, [updateData, otTypeId], (err, result) => {
            if (err) {
                console.error('❌ OT type update error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'OT type not found'
                });
            }

            res.json({
                success: true,
                message: 'OT type updated successfully',
                affectedRows: result.affectedRows
            });
        });
    }
});

// 7. DELETE: Delete OT type
app.delete('/api/ot-types/:id', (req, res) => {
    const otTypeId = req.params.id;

    console.log('🗑️ Deleting OT type:', otTypeId);

    const sql = 'DELETE FROM ot_types WHERE ot_type_id = ?';

    db.query(sql, [otTypeId], (err, result) => {
        if (err) {
            console.error('❌ OT type delete error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'OT type not found'
            });
        }

        res.json({
            success: true,
            message: 'OT type deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});
// ============= ACCOUNT DIVISIONS API =============

// 1. POST: Create new account division
app.post('/api/account-divisions', (req, res) => {
    const divisionData = req.body;

    console.log('💰 Creating account division:', divisionData.division_code);

    // Validation
    const errors = [];

    if (!divisionData.division_code) {
        errors.push('Division code is required');
    }

    if (!divisionData.division_name) {
        errors.push('Division name is required');
    }

    if (!divisionData.currency_code) {
        errors.push('Currency is required');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: errors.join(', ')
        });
    }

    // Check if division code already exists
    const checkCodeSql = 'SELECT division_id FROM account_divisions WHERE division_code = ?';

    db.query(checkCodeSql, [divisionData.division_code], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Code check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Division code "${divisionData.division_code}" already exists`
            });
        }

        // Handle default division logic
        if (divisionData.is_default) {
            // If setting as default, first unset any existing default
            const unsetDefaultSql = 'UPDATE account_divisions SET is_default = FALSE WHERE is_default = TRUE';

            db.query(unsetDefaultSql, (unsetErr, unsetResult) => {
                if (unsetErr) {
                    console.error('❌ Unset default error:', unsetErr);
                    // Continue anyway, but log error
                }

                // Now insert the new division
                insertDivision(divisionData, res);
            });
        } else {
            // Insert without default handling
            insertDivision(divisionData, res);
        }
    });
});

// Helper function to insert division
function insertDivision(divisionData, res) {
    // Set defaults
    divisionData.created_at = new Date();
    divisionData.created_by = divisionData.created_by || 1; // From session

    // Remove undefined values
    Object.keys(divisionData).forEach(key => {
        if (divisionData[key] === undefined) delete divisionData[key];
    });

    // Insert division
    const insertSql = 'INSERT INTO account_divisions SET ?';

    db.query(insertSql, divisionData, (insertErr, result) => {
        if (insertErr) {
            console.error('❌ Division create error:', insertErr);
            return res.status(500).json({
                success: false,
                error: 'Failed to create division: ' + insertErr.message
            });
        }

        console.log('✅ Division created, ID:', result.insertId);

        res.status(201).json({
            success: true,
            message: 'Account division created successfully',
            division_id: result.insertId,
            division_code: divisionData.division_code
        });
    });
}

// 2. GET: Check if division code exists
app.get('/api/account-divisions/check-code/:code', (req, res) => {
    const divisionCode = req.params.code;

    console.log('🔍 Checking division code:', divisionCode);

    if (!divisionCode) {
        return res.json({
            success: true,
            exists: false
        });
    }

    const sql = 'SELECT division_id FROM account_divisions WHERE division_code = ?';

    db.query(sql, [divisionCode], (err, results) => {
        if (err) {
            console.error('❌ Check code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            exists: results.length > 0
        });
    });
});

// 3. GET: List all account divisions
app.get('/api/account-divisions', (req, res) => {
    const {
        search = '',
        page = 1,
        limit = 20,
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching account divisions:', { search, page, limit, status });

    let sql = 'SELECT * FROM account_divisions WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (division_code LIKE ? OR division_name LIKE ? OR description LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = TRUE';
    } else if (status === 'inactive') {
        sql += ' AND is_active = FALSE';
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY is_default DESC, division_name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Divisions fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});

// 4. GET: Single division details
app.get('/api/account-divisions/:id', (req, res) => {
    const divisionId = req.params.id;

    console.log('🔍 Getting division:', divisionId);

    const sql = 'SELECT * FROM account_divisions WHERE division_id = ?';

    db.query(sql, [divisionId], (err, results) => {
        if (err) {
            console.error('❌ Division fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Division not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// 5. PUT: Update division
app.put('/api/account-divisions/:id', (req, res) => {
    const divisionId = req.params.id;
    const updateData = req.body;

    console.log('📝 Updating division:', divisionId);

    // Update timestamp
    updateData.updated_at = new Date();
    updateData.updated_by = updateData.updated_by || 1; // From session

    // Handle default division logic
    if (updateData.is_default) {
        // First unset any existing default
        const unsetDefaultSql = 'UPDATE account_divisions SET is_default = FALSE WHERE is_default = TRUE';

        db.query(unsetDefaultSql, (unsetErr, unsetResult) => {
            if (unsetErr) {
                console.error('❌ Unset default error:', unsetErr);
                // Continue anyway
            }

            // Now update the division
            updateDivision(divisionId, updateData, res);
        });
    } else {
        updateDivision(divisionId, updateData, res);
    }
});

// Helper function to update division
function updateDivision(divisionId, updateData, res) {
    const sql = 'UPDATE account_divisions SET ? WHERE division_id = ?';

    db.query(sql, [updateData, divisionId], (err, result) => {
        if (err) {
            console.error('❌ Division update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Division not found'
            });
        }

        res.json({
            success: true,
            message: 'Account division updated successfully',
            affectedRows: result.affectedRows
        });
    });
}

// 6. DELETE: Delete division
app.delete('/api/account-divisions/:id', (req, res) => {
    const divisionId = req.params.id;

    console.log('🗑️ Deleting division:', divisionId);

    // Check if this is the default division
    const checkSql = 'SELECT is_default FROM account_divisions WHERE division_id = ?';

    db.query(checkSql, [divisionId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check default error:', checkErr);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Division not found'
            });
        }

        // Prevent deletion of default division
        if (checkResult[0].is_default) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete the default division. Set another division as default first.'
            });
        }

        // Proceed with deletion
        const deleteSql = 'DELETE FROM account_divisions WHERE division_id = ?';

        db.query(deleteSql, [divisionId], (deleteErr, result) => {
            if (deleteErr) {
                console.error('❌ Division delete error:', deleteErr);
                return res.status(500).json({
                    success: false,
                    error: deleteErr.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Division not found'
                });
            }

            res.json({
                success: true,
                message: 'Account division deleted successfully',
                affectedRows: result.affectedRows
            });
        });
    });
});

// 7. GET: Test endpoint
app.get('/api/account-divisions/test', (req, res) => {
    res.json({
        success: true,
        message: 'Account Divisions API is working!',
        timestamp: new Date().toISOString()
    });
});
// ============= LEAVE TYPES API =============

// 1. GET: Check if leave code exists
app.get('/api/leave-types/check-code/:code', (req, res) => {
    const leaveCode = req.params.code;

    console.log('🔍 Checking leave code:', leaveCode);

    if (!leaveCode) {
        return res.json({
            success: true,
            exists: false
        });
    }

    const sql = 'SELECT leave_type_id FROM leave_types WHERE leave_code = ?';

    db.query(sql, [leaveCode], (err, results) => {
        if (err) {
            console.error('❌ Check leave code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            exists: results.length > 0
        });
    });
});

// 2. GET: Get next available sort code
app.get('/api/leave-types/next-sort-code', (req, res) => {
    console.log('🔢 Getting next leave type sort code...');

    const sql = 'SELECT COALESCE(MAX(sort_code), 0) + 1 as next_sort_code FROM leave_types';

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Next leave sort code error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log('✅ Next leave type sort code:', results[0].next_sort_code);

        res.json({
            success: true,
            next_sort_code: results[0].next_sort_code
        });
    });
});

// 3. POST: Create new leave type
app.post('/api/leave-types', (req, res) => {
    const leaveData = req.body;

    console.log('📝 Creating leave type:', leaveData.leave_code);

    // Validation
    const errors = [];

    if (!leaveData.leave_code) {
        errors.push('Leave code is required');
    }

    if (!leaveData.description) {
        errors.push('Description is required');
    }

    if (!leaveData.leave_per_year || leaveData.leave_per_year <= 0) {
        errors.push('Leave per year must be greater than 0');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: errors.join(', ')
        });
    }

    // Check if leave code already exists
    const checkCodeSql = 'SELECT leave_type_id FROM leave_types WHERE leave_code = ?';

    db.query(checkCodeSql, [leaveData.leave_code], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Code check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Leave code "${leaveData.leave_code}" already exists`
            });
        }

        // Check if sort code already exists (if manually provided)
        if (leaveData.sort_code && leaveData.sort_code > 0) {
            const checkSortSql = 'SELECT leave_type_id FROM leave_types WHERE sort_code = ?';

            db.query(checkSortSql, [leaveData.sort_code], (sortErr, sortResult) => {
                if (sortErr) {
                    console.error('❌ Sort code check error:', sortErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Database error: ' + sortErr.message
                    });
                }

                if (sortResult.length > 0) {
                    return res.status(409).json({
                        success: false,
                        error: `Sort code "${leaveData.sort_code}" already exists`
                    });
                }

                insertLeaveType(leaveData, res);
            });
        } else {
            // Auto-generate sort code
            const getSortSql = 'SELECT COALESCE(MAX(sort_code), 0) + 1 as next_sort FROM leave_types';

            db.query(getSortSql, (sortErr, sortResult) => {
                if (sortErr) {
                    console.error('❌ Auto sort code error:', sortErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to generate sort code'
                    });
                }

                leaveData.sort_code = sortResult[0].next_sort;
                insertLeaveType(leaveData, res);
            });
        }
    });
});

function insertLeaveType(leaveData, res) {
    // Set defaults for checkboxes (convert true/false to 1/0 for TINYINT)
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
            // Set default values
            if (field === 'auto_entitlement' || field === 'is_active') {
                leaveData[field] = 1;
            } else {
                leaveData[field] = 0;
            }
        }
    });

    // Set default values for string fields
    if (!leaveData.carry_forward_type) leaveData.carry_forward_type = 'none';
    if (!leaveData.pay_type) leaveData.pay_type = 'paid';
    if (!leaveData.entitlement_type) leaveData.entitlement_type = 'year';
    if (!leaveData.earned_type) leaveData.earned_type = 'calendar_year';

    // Set audit fields
    leaveData.created_at = new Date();
    leaveData.created_by = leaveData.created_by || 1; // From session

    console.log('📤 Inserting leave data:', leaveData);

    // Insert leave type
    const insertSql = 'INSERT INTO leave_types SET ?';

    db.query(insertSql, leaveData, (insertErr, result) => {
        if (insertErr) {
            console.error('❌ Leave type create error:', insertErr);
            return res.status(500).json({
                success: false,
                error: 'Failed to create leave type: ' + insertErr.message
            });
        }

        console.log('✅ Leave type created, ID:', result.insertId);

        res.status(201).json({
            success: true,
            message: 'Leave type created successfully',
            leave_type_id: result.insertId,
            leave_code: leaveData.leave_code,
            sort_code: leaveData.sort_code
        });
    });
}

// 4. GET: List all leave types
app.get('/api/leave-types', (req, res) => {
    const {
        search = '',
        page = 1,
        limit = 20,
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching leave types:', { search, page, limit, status });

    let sql = 'SELECT * FROM leave_types WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (leave_code LIKE ? OR description LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    // Status filter
    if (status === 'active') {
        sql += ' AND is_active = 1';
    } else if (status === 'inactive') {
        sql += ' AND is_active = 0';
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY sort_code ASC, leave_code ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Leave types fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});

// 5. Test endpoint
app.get('/api/leave-types/test', (req, res) => {
    res.json({
        success: true,
        message: 'Leave Types API is working!',
        timestamp: new Date().toISOString()
    });
});
// Add these endpoints to your server.js:

// 6. GET: Single leave type details
app.get('/api/leave-types/:id', (req, res) => {
    const leaveId = req.params.id;

    console.log('🔍 Getting leave type:', leaveId);

    const sql = 'SELECT * FROM leave_types WHERE leave_type_id = ?';

    db.query(sql, [leaveId], (err, results) => {
        if (err) {
            console.error('❌ Leave type fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave type not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// 7. PUT: Update leave type
app.put('/api/leave-types/:id', (req, res) => {
    const leaveId = req.params.id;
    const updateData = req.body;

    console.log('📝 Updating leave type:', leaveId);

    // Update timestamp
    updateData.updated_at = new Date();

    const sql = 'UPDATE leave_types SET ? WHERE leave_type_id = ?';

    db.query(sql, [updateData, leaveId], (err, result) => {
        if (err) {
            console.error('❌ Leave type update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave type not found'
            });
        }

        res.json({
            success: true,
            message: 'Leave type updated successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 8. DELETE: Delete leave type
app.delete('/api/leave-types/:id', (req, res) => {
    const leaveId = req.params.id;

    console.log('🗑️ Deleting leave type:', leaveId);

    const sql = 'DELETE FROM leave_types WHERE leave_type_id = ?';

    db.query(sql, [leaveId], (err, result) => {
        if (err) {
            console.error('❌ Leave type delete error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Leave type not found'
            });
        }

        res.json({
            success: true,
            message: 'Leave type deleted successfully',
            affectedRows: result.affectedRows
        });
    });
});

// 9. Enhanced GET with entitlement filter
app.get('/api/leave-types', (req, res) => {
    const {
        search = '',
        page = 1,
        limit = 20,
        entitlement = 'all' // New parameter
    } = req.query;

    const offset = (page - 1) * limit;

    console.log('📋 Fetching leave types:', { search, page, limit, entitlement });

    let sql = 'SELECT * FROM leave_types WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
        sql += ' AND (leave_code LIKE ? OR description LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm);
    }

    // Entitlement filter
    if (entitlement === 'true') {
        sql += ' AND auto_entitlement = 1';
    } else if (entitlement === 'false') {
        sql += ' AND auto_entitlement = 0';
    }

    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        // Add ordering and pagination
        sql += ' ORDER BY sort_code ASC, leave_code ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('❌ Leave types fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});
// ============= CURRENCY API =============

// POST: /api/currencies - Create currency
app.post('/api/currencies', (req, res) => {
    try {
        const currencyData = req.body;

        console.log('💰 Creating currency:', currencyData.currency_code);

        // Validation
        const errors = [];

        if (!currencyData.currency_code) {
            errors.push('Currency code is required');
        }

        if (!currencyData.currency_name) {
            errors.push('Currency name is required');
        }

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // Check if currency code already exists
        const checkSql = 'SELECT currency_id FROM currencies WHERE currency_code = ?';

        db.query(checkSql, [currencyData.currency_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Currency check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Currency code "${currencyData.currency_code}" already exists`
                });
            }

            // Handle default currency logic in application
            const handleDefaultCurrency = (callback) => {
                if (currencyData.is_default) {
                    // First, set all currencies to non-default
                    const resetSql = 'UPDATE currencies SET is_default = FALSE WHERE is_default = TRUE';
                    db.query(resetSql, (resetErr, resetResult) => {
                        if (resetErr) {
                            return callback(resetErr);
                        }
                        console.log('✅ Reset other currencies to non-default');
                        callback(null);
                    });
                } else {
                    callback(null);
                }
            };

            // Process default currency logic
            handleDefaultCurrency((defaultErr) => {
                if (defaultErr) {
                    console.error('❌ Default currency error:', defaultErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Default currency error: ' + defaultErr.message
                    });
                }

                // Set defaults
                const defaults = {
                    decimal_places: 2,
                    exchange_rate: 1.000000,
                    currency_format: 'Dollar ($1,234,567.89)',
                    is_active: true,
                    is_default: currencyData.is_default || false,
                    created_at: new Date()
                };

                const finalData = { ...defaults, ...currencyData };

                // Parse numeric values
                finalData.exchange_rate = parseFloat(finalData.exchange_rate) || 1.000000;
                finalData.decimal_places = parseInt(finalData.decimal_places) || 2;

                // Insert currency
                const insertSql = 'INSERT INTO currencies SET ?';

                db.query(insertSql, finalData, (err, result) => {
                    if (err) {
                        console.error('❌ Currency create error:', err);
                        return res.status(500).json({
                            success: false,
                            error: err.message
                        });
                    }

                    res.status(201).json({
                        success: true,
                        message: 'Currency created successfully',
                        currency_id: result.insertId,
                        currency_code: finalData.currency_code
                    });
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});


// GET: /api/currencies with sorting
app.get('/api/currencies', (req, res) => {
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const sort = req.query.sort || 'currency_code';
    const order = req.query.order || 'asc';
    const offset = (page - 1) * limit;

    // Validate sort column
    const validSortColumns = ['currency_code', 'currency_name', 'exchange_rate', 'is_default', 'is_active', 'created_at'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'currency_code';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
        whereClause += ' AND (currency_code LIKE ? OR currency_name LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }

    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM currencies ${whereClause}`;

    db.query(countSql, params, (countErr, countResult) => {
        if (countErr) {
            console.error('❌ Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get data with sorting
        const sql = `
            SELECT 
                *,
                DATE_FORMAT(created_at, '%d-%m-%Y %H:%i') as formatted_created_at,
                DATE_FORMAT(updated_at, '%d-%m-%Y %H:%i') as formatted_updated_at
            FROM currencies
            ${whereClause}
            ORDER BY ${sortColumn} ${sortOrder}, currency_code ASC
            LIMIT ? OFFSET ?
        `;

        db.query(sql, [...params, limit, offset], (err, results) => {
            if (err) {
                console.error('❌ Currencies fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });
        });
    });
});
// POST: /api/currencies/update-rates - Batch update rates

app.post('/api/currencies/update-rates', (req, res) => {
    const { effective_date, rates } = req.body;

    if (!effective_date || !rates || !Array.isArray(rates)) {
        return res.json({ success: false, error: 'Missing data' });
    }

    let updated = 0;
    let processed = 0;

    rates.forEach(rate => {
        // FIRST: Get current rate before updating
        const getCurrentSql = 'SELECT exchange_rate FROM currencies WHERE currency_id = ?';

        db.query(getCurrentSql, [rate.currency_id], (getErr, getResult) => {
            if (getErr || getResult.length === 0) {
                processed++;
                checkCompletion();
                return;
            }

            const oldRate = getResult[0].exchange_rate;
            const newRate = rate.new_rate;

            // Calculate percentage change
            const changePercent = oldRate ?
                ((newRate - oldRate) / oldRate * 100).toFixed(4) :
                0;

            // UPDATE the rate
            const updateSql = 'UPDATE currencies SET exchange_rate = ?, updated_at = NOW() WHERE currency_id = ?';

            db.query(updateSql, [newRate, rate.currency_id], (updateErr, updateResult) => {
                if (!updateErr && updateResult.affectedRows > 0) {
                    updated++;

                    // Save to history WITH OLD RATE
                    const historySql = `
                        INSERT INTO currency_rate_history 
                        (currency_id, old_rate, new_rate, effective_date, change_percentage, notes, changed_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `;

                    db.query(historySql, [
                        rate.currency_id,
                        oldRate,
                        newRate,
                        effective_date,
                        changePercent,
                        'Rate update',
                        'admin'
                    ], (historyErr) => {
                        if (historyErr) console.log('History error:', historyErr.message);
                    });
                }

                processed++;
                checkCompletion();
            });
        });
    });

    function checkCompletion() {
        if (processed === rates.length) {
            res.json({
                success: true,
                message: `Updated ${updated} rates`,
                updated_count: updated
            });
        }
    }
});
// GET: /api/currencies/:id - Get single currency
app.get('/api/currencies/:id', (req, res) => {
    const currencyId = req.params.id;

    const sql = 'SELECT * FROM currencies WHERE currency_id = ?';

    db.query(sql, [currencyId], (err, results) => {
        if (err) {
            console.error('❌ Currency fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Currency not found'
            });
        }

        res.json({
            success: true,
            data: results[0]
        });
    });
});

// PUT: /api/currencies/:id - Update currency
app.put('/api/currencies/:id', (req, res) => {
    const currencyId = req.params.id;
    const updateData = req.body;

    console.log(`✏️ Updating currency ${currencyId}:`, updateData);

    // Validation
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

    // Handle default currency logic
    const handleDefaultCurrency = (callback) => {
        if (updateData.is_default === true) {
            // First, set all currencies to non-default
            const resetSql = 'UPDATE currencies SET is_default = FALSE WHERE is_default = TRUE';
            db.query(resetSql, (resetErr, resetResult) => {
                if (resetErr) {
                    return callback(resetErr);
                }
                console.log('✅ Reset other currencies to non-default');
                callback(null);
            });
        } else {
            callback(null);
        }
    };

    // Process default currency update
    handleDefaultCurrency((defaultErr) => {
        if (defaultErr) {
            console.error('❌ Default currency error:', defaultErr);
            return res.status(500).json({
                success: false,
                error: 'Default currency error: ' + defaultErr.message
            });
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

        const sql = 'UPDATE currencies SET ? WHERE currency_id = ?';

        db.query(sql, [updateData, currencyId], (err, result) => {
            if (err) {
                console.error('❌ Currency update error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Currency not found'
                });
            }

            res.json({
                success: true,
                message: 'Currency updated successfully',
                affectedRows: result.affectedRows
            });
        });
    });
});

// DELETE: /api/currencies/:id - Delete currency
app.delete('/api/currencies/:id', (req, res) => {
    const currencyId = req.params.id;

    // Check if currency is default
    const checkSql = 'SELECT currency_code, is_default FROM currencies WHERE currency_id = ?';

    db.query(checkSql, [currencyId], (checkErr, checkResult) => {
        if (checkErr) {
            console.error('❌ Check error:', checkErr);
            return res.status(500).json({
                success: false,
                error: checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Currency not found'
            });
        }

        if (checkResult[0].is_default) {
            return res.status(409).json({
                success: false,
                error: 'Cannot delete default currency. Set another currency as default first.'
            });
        }

        // Perform delete
        const deleteSql = 'DELETE FROM currencies WHERE currency_id = ?';

        db.query(deleteSql, [currencyId], (err, result) => {
            if (err) {
                console.error('❌ Delete error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            res.json({
                success: true,
                message: 'Currency deleted successfully',
                deleted_id: currencyId
            });
        });
    });
});
// GET: /api/currencies/update - Get currencies for rate update (with all status)
app.get('/api/currencies/update', (req, res) => {
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

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Currencies update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});
app.get('/api/currencies/:id/rate-history', (req, res) => {
    const currencyId = req.params.id;
    const limit = parseInt(req.query.limit) || 10;

    const sql = `
        SELECT 
            history_id,
            currency_id,
            old_rate,
            new_rate,
            DATE_FORMAT(effective_date, '%Y-%m-%d') as effective_date,
            change_percentage,
            notes,
            changed_by,
            DATE_FORMAT(changed_at, '%d-%m-%Y %H:%i') as changed_at
        FROM currency_rate_history
        WHERE currency_id = ?
        ORDER BY effective_date DESC, changed_at DESC
        LIMIT ?
    `;

    db.query(sql, [currencyId, limit], (err, results) => {
        if (err) {
            console.error('History error:', err);
            return res.json({
                success: true,
                data: [],
                message: 'No history available'
            });
        }

        // Get currency info
        db.query('SELECT currency_code, currency_name FROM currencies WHERE currency_id = ?',
            [currencyId],
            (currencyErr, currencyResult) => {
                const currencyInfo = currencyResult.length > 0 ? currencyResult[0] : {};

                res.json({
                    success: true,
                    data: results,
                    currency_info: currencyInfo,
                    count: results.length
                });
            }
        );
    });
});
app.get('/api/currencies/rate-history/all', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    const sql = `
        SELECT 
            crh.history_id,
            crh.currency_id,
            c.currency_code,
            c.currency_name,
            crh.old_rate,
            crh.new_rate,
            DATE_FORMAT(crh.effective_date, '%d-%m-%Y') as effective_date,
            crh.change_percentage,
            crh.notes,
            crh.changed_by,
            DATE_FORMAT(crh.changed_at, '%d-%m-%Y %H:%i') as changed_at,
            CASE 
                WHEN crh.change_percentage > 0 THEN 'increase'
                WHEN crh.change_percentage < 0 THEN 'decrease'
                ELSE 'no change'
            END as change_type
        FROM currency_rate_history crh
        JOIN currencies c ON crh.currency_id = c.currency_id
        ORDER BY crh.changed_at DESC
        LIMIT ? OFFSET ?
    `;

    db.query(sql, [limit, offset], (err, results) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});

// POST: /api/currencies/:id/rate-history - Add rate history entry
app.post('/api/currencies/:id/rate-history', (req, res) => {
    const currencyId = req.params.id;
    const { exchange_rate, effective_date, notes, created_by } = req.body;

    if (!exchange_rate || !effective_date) {
        return res.status(400).json({
            success: false,
            error: 'Exchange rate and effective date are required'
        });
    }

    const sql = `
        INSERT INTO currency_rates_history 
        (currency_id, exchange_rate, effective_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?)
    `;

    const params = [
        currencyId,
        parseFloat(exchange_rate),
        effective_date,
        notes || 'Rate updated',
        created_by || 'system'
    ];

    db.query(sql, params, (err, result) => {
        if (err) {
            console.error('❌ Rate history insert error:', err);
            return res.status(500).json({
                success: false,
                error: 'Failed to save rate history: ' + err.message
            });
        }

        res.status(201).json({
            success: true,
            message: 'Rate history saved',
            history_id: result.insertId
        });
    });
});

// GET: /api/currencies/active - Get active currencies
app.get('/api/currencies/active', (req, res) => {
    try {
        console.log('🌐 Fetching active currencies');

        const sql = `
            SELECT 
                currency_id, 
                currency_code, 
                currency_name,
                currency_symbol,
                exchange_rate,
                is_default,
                decimal_places
            FROM currencies 
            WHERE is_active = 1
            ORDER BY is_default DESC, currency_code ASC
        `;

        db.query(sql, (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + err.message
                });
            }

            console.log(`✅ Found ${results.length} active currencies`);

            res.json({
                success: true,
                data: results,
                count: results.length
            });
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// ===============Charts of Account=========================

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


        // Check if code already exists
        const checkSql = 'SELECT account_id FROM chart_of_accounts WHERE account_code = ?';

        db.query(checkSql, [account_code], (checkErr, checkResult) => {
            if (checkErr) throw checkErr;

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Account code "${account_code}" already exists`
                });
            }

            // Calculate root level
            let rootLevel = 0;
            if (parent_account_id) {
                // Get parent's level
                db.query('SELECT root_level FROM chart_of_accounts WHERE account_id = ?',
                    [parent_account_id],
                    (parentErr, parentResult) => {
                        if (!parentErr && parentResult.length > 0) {
                            rootLevel = parentResult[0].root_level + 1;
                        }
                        insertAccount(rootLevel);
                    }
                );
            } else {
                rootLevel = 1;
                insertAccount(rootLevel);
            }

            function insertAccount(level) {
                const insertData = {
                    account_code,
                    account_name,
                    description,
                    parent_account_id: parent_account_id || null,
                    account_type,
                    currency_id,
                    is_placeholder: is_placeholder || false,
                    is_system_account: is_system_account || false,
                    is_active: true,
                    root_level: level,
                    opening_balance: opening_balance || 0,
                    current_balance: opening_balance || 0,
                    created_by: 'admin'
                };

                const insertSql = 'INSERT INTO chart_of_accounts SET ?';

                db.query(insertSql, insertData, (insertErr, result) => {
                    if (insertErr) throw insertErr;

                    res.status(201).json({
                        success: true,
                        message: 'Account created successfully',
                        account_id: result.insertId,
                        account_code
                    });
                });
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// Add this after your other currency routes in server.js


// POST: /api/accounts - Create new account
app.post('/api/accounts', (req, res) => {
    try {
        const accountData = req.body;

        console.log('📊 Creating account:', accountData.account_code);

        // Validation
        const errors = [];

        if (!accountData.account_code) errors.push('Account code is required');
        if (!accountData.account_name) errors.push('Account name is required');
        if (!accountData.currency_id) errors.push('Currency is required');
        if (!accountData.account_type) errors.push('Account type is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // Validate account code format
        if (!/^[0-9]+(-[0-9]+)*$/.test(accountData.account_code)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid account code format. Use: 100 or 100-001'
            });
        }

        // Check if code already exists
        const checkSql = 'SELECT account_id FROM chart_of_accounts WHERE account_code = ?';

        db.query(checkSql, [accountData.account_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Account check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Account code "${accountData.account_code}" already exists`
                });
            }

            // Calculate root level
            let rootLevel = 0;
            if (accountData.parent_account_id) {
                const levelSql = 'SELECT root_level FROM chart_of_accounts WHERE account_id = ?';
                db.query(levelSql, [accountData.parent_account_id], (levelErr, levelResult) => {
                    if (levelErr || levelResult.length === 0) {
                        rootLevel = 1;
                    } else {
                        rootLevel = levelResult[0].root_level + 1;
                    }
                    insertAccount(rootLevel);
                });
            } else {
                rootLevel = 1;
                insertAccount(rootLevel);
            }

            function insertAccount(level) {
                // Prepare final data
                const finalData = {
                    account_code: accountData.account_code,
                    account_name: accountData.account_name,
                    description: accountData.description || null,
                    currency_id: accountData.currency_id,
                    parent_account_id: accountData.parent_account_id || null,
                    account_type: accountData.account_type,
                    is_placeholder: accountData.is_placeholder ? 1 : 0,
                    is_system_account: accountData.is_system_account ? 1 : 0,
                    is_active: accountData.is_active ? 1 : 0,
                    is_root: accountData.parent_account_id ? 0 : 1,
                    root_level: level,
                    opening_balance: accountData.opening_balance || 0,
                    current_balance: accountData.opening_balance || 0,
                    created_by: 'admin',
                    updated_by: 'admin'
                };

                // Insert account
                const insertSql = 'INSERT INTO chart_of_accounts SET ?';

                db.query(insertSql, finalData, (err, result) => {
                    if (err) {
                        console.error('❌ Account insert error:', err);
                        return res.status(500).json({
                            success: false,
                            error: 'Failed to create account: ' + err.message
                        });
                    }

                    console.log(`✅ Account created: ${accountData.account_code} (ID: ${result.insertId})`);

                    res.status(201).json({
                        success: true,
                        message: 'Account created successfully',
                        account_id: result.insertId,
                        account_code: accountData.account_code,
                        account_name: accountData.account_name
                    });
                });
            }
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// GET: /api/accounts/parents - Get placeholder accounts for dropdown
// GET: /api/accounts/parents - Get ONLY placeholder accounts
app.get('/api/accounts/parents', (req, res) => {
    console.log('📞 Fetching parent accounts (placeholders only)');

    const sql = `
        SELECT 
            account_id,
            account_code,
            account_name,
            account_type,
            root_level,
            is_placeholder,
            is_root,
            CAST(SUBSTRING_INDEX(account_code, '-', 1) AS UNSIGNED) as sort_part1,
            CASE 
                WHEN LOCATE('-', account_code) > 0 
                THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(account_code, '-', 2), '-', -1) AS UNSIGNED)
                ELSE 0 
            END as sort_part2,
            CASE 
                WHEN (LENGTH(account_code) - LENGTH(REPLACE(account_code, '-', ''))) >= 2
                THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(account_code, '-', 3), '-', -1) AS UNSIGNED)
                ELSE 0 
            END as sort_part3
        FROM chart_of_accounts 
        WHERE is_placeholder = 1 
          AND is_active = 1
        ORDER BY 
            -- Root first
            CASE WHEN account_code = 'ROOT' THEN 0 ELSE 1 END,
            -- Then proper code order
            sort_part1,
            sort_part2,
            sort_part3,
            account_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Parent accounts error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log(`✅ Found ${results.length} placeholder accounts (now ordered)`);

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
// GET: /api/accounts/suggest-code - Suggest next account code
app.get('/api/accounts/suggest-code', (req, res) => {
    const parentCode = req.query.parent;
    const level = parseInt(req.query.level) || 1;

    if (!parentCode) {
        return res.json({
            success: false,
            error: 'Parent code required'
        });
    }

    if (parentCode === 'ROOT') {
        // For ROOT, suggest main categories: 100, 200, 300, etc.
        const sql = `
            SELECT MAX(CAST(SUBSTRING_INDEX(account_code, '-', 1) AS UNSIGNED)) as max_code
            FROM chart_of_accounts 
            WHERE parent_account_id IS NULL 
              AND account_code REGEXP '^[0-9]+$'
        `;

        db.query(sql, (err, results) => {
            if (err) {
                console.error('Suggestion error:', err);
                return res.json({
                    success: true,
                    suggested_code: '100'
                });
            }

            const maxCode = results[0]?.max_code || 0;
            const nextCode = (maxCode + 100) - (maxCode % 100);
            const suggestedCode = String(nextCode).padStart(3, '0');

            res.json({
                success: true,
                suggested_code: suggestedCode
            });
        });

    } else {
        // For sub-accounts
        const parentPattern = parentCode.replace(/-/g, '[-]');

        const sql = `
            SELECT account_code
            FROM chart_of_accounts 
            WHERE account_code LIKE ? 
              AND account_code REGEXP ?
            ORDER BY account_code DESC
            LIMIT 1
        `;

        const pattern = `^${parentPattern}-[0-9]+$`;

        db.query(sql, [`${parentCode}-%`, pattern], (err, results) => {
            if (err || results.length === 0) {
                // First child
                return res.json({
                    success: true,
                    suggested_code: `${parentCode}-001`
                });
            }

            // Get last code and increment
            const lastCode = results[0].account_code;
            const parts = lastCode.split('-');
            const lastNumber = parseInt(parts[parts.length - 1]);
            const nextNumber = lastNumber + 1;

            parts[parts.length - 1] = String(nextNumber).padStart(3, '0');
            const suggestedCode = parts.join('-');

            res.json({
                success: true,
                suggested_code: suggestedCode
            });
        });
    }
});
// ============= CHART OF ACCOUNTS LISTING API =============
// =============== GET ALL ACCOUNTS ========================
app.get('/api/accounts/all', (req, res) => {
    try {
        console.log('📊 Fetching ALL accounts (no pagination)');

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
                CAST(SUBSTRING_INDEX(a.account_code, '-', 1) AS UNSIGNED) as code_part1,
                CASE 
                    WHEN LOCATE('-', a.account_code) > 0 
                    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.account_code, '-', 2), '-', -1) AS UNSIGNED)
                    ELSE 0 
                END as code_part2,
                CASE 
                    WHEN (LENGTH(a.account_code) - LENGTH(REPLACE(a.account_code, '-', ''))) >= 2
                    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.account_code, '-', 3), '-', -1) AS UNSIGNED)
                    ELSE 0 
                END as code_part3
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE a.is_active = 1
            ORDER BY 
                code_part1 ASC,
                code_part2 ASC,
                code_part3 ASC,
                a.account_code ASC
        `;

        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ All accounts error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log(`✅ Found ${results.length} total accounts`);

            // Format results
            const formattedResults = results.map(account => {
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
                count: results.length
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.get('/api/accounts', (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            type = '',
            parent = ''

        } = req.query;

        const offset = (page - 1) * limit;

        console.log('📊 Fetching accounts with params:', { page, limit, search, type, parent });

        // Base SQL query
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
                -- For natural sorting: split code into parts
                CAST(SUBSTRING_INDEX(a.account_code, '-', 1) AS UNSIGNED) as code_part1,
                CASE 
                    WHEN LOCATE('-', a.account_code) > 0 
                    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.account_code, '-', 2), '-', -1) AS UNSIGNED)
                    ELSE 0 
                END as code_part2,
                CASE 
                    WHEN (LENGTH(a.account_code) - LENGTH(REPLACE(a.account_code, '-', ''))) >= 2
                    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.account_code, '-', 3), '-', -1) AS UNSIGNED)
                    ELSE 0 
                END as code_part3
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE a.is_active = 1
        `;

        const params = [];

        // Apply filters
        if (search) {
            sql += ` AND (a.account_code LIKE ? OR a.account_name LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        if (type && type !== 'ALL' && type !== 'All Types') {
            sql += ` AND a.account_type = ?`;
            params.push(type);
        }

        if (parent === 'ROOT') {
            sql += ` AND a.parent_account_id IS NULL`;
        } else if (parent && parent !== 'Root') {
            sql += ` AND p.account_code = ?`;
            params.push(parent);
        }

        // Count total
        const countSql = `SELECT COUNT(*) as total FROM (${sql}) as filtered`;

        // **CORRECT HIERARCHICAL ORDER**
        sql += ` 
            ORDER BY 
                -- First: Root accounts (parent_id IS NULL)
                CASE WHEN a.parent_account_id IS NULL THEN 0 ELSE 1 END,
                -- Second: Sort by code parts for natural ordering
                code_part1,
                code_part2,
                code_part3,
                -- Third: Account code as fallback
                a.account_code,
                a.root_level
            LIMIT ? OFFSET ?
        `;

        params.push(parseInt(limit), parseInt(offset));

        console.log('SQL Query:', sql);

        // Get total count
        db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
            if (countErr) {
                console.error('❌ Count error:', countErr);
                return res.status(500).json({
                    success: false,
                    error: countErr.message
                });
            }

            const total = countResult[0]?.total || 0;

            // Get data
            db.query(sql, params, (err, results) => {
                if (err) {
                    console.error('❌ Fetch error:', err);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }

                console.log(`✅ Found ${results.length} accounts, total: ${total}`);

                // Format results for hierarchy display
                const formattedResults = results.map(account => {
                    // Determine balance color
                    const balance = account.current_balance || 0;
                    let balanceFormatted = '';
                    let balanceColor = '#64748b';

                    if (balance !== 0) {
                        balanceFormatted = Math.abs(balance).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                        });

                        if (balance > 0) {
                            balanceColor = '#2e7d32'; // Green for positive
                            balanceFormatted = balanceFormatted;
                        } else {
                            balanceColor = '#d32f2f'; // Red for negative
                            balanceFormatted = `(${balanceFormatted})`;
                        }
                    }

                    // Create display name with indentation
                    let displayName = account.account_name;
                    let codeClass = '';

                    if (account.root_level > 0) {
                        // Add visual indentation for hierarchy
                        const indentPx = (account.root_level - 1) * 20;
                        codeClass = `level-${account.root_level}`;
                        displayName = `<span style="display: inline-block; padding-left: ${indentPx}px; position: relative;">
                            ${account.root_level > 1 ? '├─ ' : ''}${account.account_name}
                        </span>`;
                    }

                    return {
                        ...account,
                        display_name_html: displayName,
                        display_name: account.account_name,
                        parent_display: account.parent_account_name || 'Root',
                        balance_formatted: balanceFormatted,
                        balance_color: balanceColor,
                        balance_raw: balance,
                        code_class: codeClass
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
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// PUT: /api/accounts/:id - Update account
app.put('/api/accounts/:id', (req, res) => {
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

        // Check if account exists
        const checkSql = 'SELECT account_id, account_code FROM chart_of_accounts WHERE account_id = ?';

        db.query(checkSql, [accountId], (checkErr, checkResult) => {
            if (checkErr) throw checkErr;

            if (checkResult.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Account not found'
                });
            }

            const account = checkResult[0];

            // Calculate new root level if parent changed
            if (updateData.parent_account_id !== undefined) {
                let newLevel = 1;

                if (updateData.parent_account_id) {
                    // Get parent's level
                    db.query('SELECT root_level FROM chart_of_accounts WHERE account_id = ?',
                        [updateData.parent_account_id],
                        (parentErr, parentResult) => {
                            if (parentErr) throw parentErr;

                            if (parentResult.length > 0) {
                                newLevel = parentResult[0].root_level + 1;
                            }

                            performUpdate(newLevel);
                        }
                    );
                } else {
                    performUpdate(newLevel);
                }
            } else {
                performUpdate(null);
            }

            function performUpdate(newLevel) {
                // Prepare update data
                const finalUpdateData = {
                    account_name: updateData.account_name,
                    description: updateData.description || null,
                    currency_id: updateData.currency_id,
                    account_type: updateData.account_type,
                    is_placeholder: updateData.is_placeholder ? 1 : 0,
                    is_system_account: updateData.is_system_account ? 1 : 0,
                    is_active: updateData.is_active ? 1 : 0,
                    updated_by: updateData.updated_by || 'admin',
                    updated_at: new Date()
                };

                // Add parent if provided
                if (updateData.parent_account_id !== undefined) {
                    finalUpdateData.parent_account_id = updateData.parent_account_id || null;
                }

                // Add level if calculated
                if (newLevel !== null) {
                    finalUpdateData.root_level = newLevel;
                }

                // Update account
                const updateSql = 'UPDATE chart_of_accounts SET ? WHERE account_id = ?';

                db.query(updateSql, [finalUpdateData, accountId], (updateErr, updateResult) => {
                    if (updateErr) {
                        console.error('❌ Update error:', updateErr);
                        return res.status(500).json({
                            success: false,
                            error: 'Database error: ' + updateErr.message
                        });
                    }

                    console.log(`✅ Account "${account.account_code}" updated successfully`);

                    res.json({
                        success: true,
                        message: 'Account updated successfully',
                        account_id: accountId,
                        account_code: account.account_code
                    });
                });
            }
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// UPDATE: /api/accounts/:id/details - Get account details (ACTIVE or INACTIVE)
app.get('/api/accounts/:id/details', (req, res) => {
    try {
        const accountId = req.params.id;

        console.log(`📋 Getting details for account ID: ${accountId}`);

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
                    AND child.is_active = 1  -- Only active children
                ) as child_count,
                (
                    SELECT GROUP_CONCAT(CONCAT(child.account_code, ' - ', child.account_name) SEPARATOR '\n')
                    FROM chart_of_accounts child 
                    WHERE child.parent_account_id = a.account_id 
                    AND child.is_active = 1
                    LIMIT 5
                ) as child_accounts_list
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_account_id = p.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE a.account_id = ?  -- REMOVED: AND a.is_active = 1
        `;

        db.query(sql, [accountId], (err, results) => {
            if (err) {
                console.error('❌ Details error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Account not found'
                });
            }

            const account = results[0];

            res.json({
                success: true,
                data: account
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// HARD DELETE: /api/accounts/:id/hard - Permanently delete from database

app.put('/api/accounts/:id/reactivate', (req, res) => {
    const accountId = req.params.id;

    const sql = `
        UPDATE chart_of_accounts 
        SET is_active = 1, 
            updated_at = NOW()
        WHERE account_id = ? AND is_active = 0
    `;

    db.query(sql, [accountId], (err, result) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.json({
                success: false,
                error: 'Account not found or already active'
            });
        }

        res.json({
            success: true,
            message: 'Account reactivated successfully'
        });
    });
});
// =============== HARD DELETE ACCOUNT ========================
// DELETE: /api/accounts/:id/hard - PERMANENTLY DELETE FROM DATABASE
app.delete('/api/accounts/:id/hard', (req, res) => {
    const accountId = req.params.id;

    console.log(`💀 HARD DELETE requested for account ID: ${accountId}`);

    // 1. Check if account exists
    const checkSql = `SELECT account_id, account_code, account_name FROM chart_of_accounts WHERE account_id = ?`;

    db.query(checkSql, [accountId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Account not found'
            });
        }

        const account = checkResult[0];

        // 2. Check if has active child accounts
        const childCheckSql = `SELECT COUNT(*) as child_count FROM chart_of_accounts WHERE parent_account_id = ?`;

        db.query(childCheckSql, [accountId], (childErr, childResult) => {
            if (childErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + childErr.message
                });
            }

            const childCount = childResult[0]?.child_count || 0;

            if (childCount > 0) {
                return res.status(400).json({
                    success: false,
                    error: `Cannot delete account "${account.account_code}" - It has ${childCount} child account(s). Delete child accounts first.`
                });
            }

            // 3. Check balance - simple version
            const balanceCheckSql = `SELECT current_balance FROM chart_of_accounts WHERE account_id = ?`;

            db.query(balanceCheckSql, [accountId], (balanceErr, balanceResult) => {
                if (balanceErr) {
                    return res.status(500).json({
                        success: false,
                        error: 'Database error: ' + balanceErr.message
                    });
                }

                const balance = balanceResult[0]?.current_balance || 0;

                // 4. DELETE FROM DATABASE
                const deleteSql = `DELETE FROM chart_of_accounts WHERE account_id = ?`;

                db.query(deleteSql, [accountId], (deleteErr, deleteResult) => {
                    if (deleteErr) {
                        return res.status(500).json({
                            success: false,
                            error: 'Delete failed: ' + deleteErr.message
                        });
                    }

                    console.log(`✅ Account "${account.account_code}" permanently deleted`);

                    res.json({
                        success: true,
                        message: `Account "${account.account_code} - ${account.account_name}" permanently deleted`,
                        balance_deleted: balance,
                        deleted_account: account
                    });
                });
            });
        });
    });
});
//=======================BANK BACKEND API ============================//
app.post('/api/banks', (req, res) => {
    try {
        const bankData = req.body;

        console.log('🏦 Creating bank:', bankData.bank_name);

        // Validation
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

        // Check if bank code already exists
        const checkSql = 'SELECT bank_id FROM banks WHERE bank_code = ?';

        db.query(checkSql, [bankData.bank_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Bank check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Bank code "${bankData.bank_code}" already exists`
                });
            }

            // Check if chart account exists and is not placeholder
            const accountSql = 'SELECT account_id, is_placeholder FROM chart_of_accounts WHERE account_id = ?';

            db.query(accountSql, [bankData.chart_account_id], (accountErr, accountResult) => {
                if (accountErr) {
                    return res.status(500).json({
                        success: false,
                        error: 'Database error: ' + accountErr.message
                    });
                }

                if (accountResult.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Selected chart account does not exist'
                    });
                }

                // CRITICAL: Check if account is NOT a placeholder
                if (accountResult[0].is_placeholder) {
                    return res.status(400).json({
                        success: false,
                        error: 'Cannot select a placeholder account for bank'
                    });
                }

                // Check if currency exists
                const currencySql = 'SELECT currency_id FROM currencies WHERE currency_id = ? AND is_active = 1';

                db.query(currencySql, [bankData.currency_id], (currencyErr, currencyResult) => {
                    if (currencyErr) {
                        return res.status(500).json({
                            success: false,
                            error: 'Database error: ' + currencyErr.message
                        });
                    }

                    if (currencyResult.length === 0) {
                        return res.status(400).json({
                            success: false,
                            error: 'Selected currency does not exist or is inactive'
                        });
                    }

                    // If setting as default, unset other defaults
                    if (bankData.is_default) {
                        const unsetDefaultSql = 'UPDATE banks SET is_default = 0 WHERE is_default = 1';
                        db.query(unsetDefaultSql, (unsetErr) => {
                            if (unsetErr) {
                                console.error('❌ Unset default error:', unsetErr);
                            }
                            insertBank(bankData);
                        });
                    } else {
                        insertBank(bankData);
                    }
                });
            });
        });

        function insertBank(data) {
            const insertData = {
                bank_code: data.bank_code,
                bank_name: data.bank_name,
                display_name: data.display_name,
                account_number: data.account_number,
                beneficiary_name: data.beneficiary_name,
                phone_number: data.phone_number,
                branch_code: data.branch_code,
                swift_code: data.swift_code,
                ifsc_code: data.ifsc_code,
                account_type: data.account_type || 'CURRENT',
                file_format: data.file_format || 'GENERIC',
                chart_account_id: data.chart_account_id,
                address1: data.address1,
                address2: data.address2,
                address3: data.address3,
                city: data.city,
                country: data.country || 'Singapore',
                postal_code: data.postal_code,
                currency_id: data.currency_id,
                is_active: data.is_active !== undefined ? data.is_active : true,
                is_default: data.is_default || false,
                created_by: 'admin',
                updated_by: 'admin'
            };

            const insertSql = 'INSERT INTO banks SET ?';

            db.query(insertSql, insertData, (insertErr, result) => {
                if (insertErr) {
                    console.error('❌ Bank insert error:', insertErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create bank: ' + insertErr.message
                    });
                }

                console.log(`✅ Bank created: ${data.bank_code} (ID: ${result.insertId})`);

                res.status(201).json({
                    success: true,
                    message: 'Bank created successfully',
                    bank_id: result.insertId,
                    bank_code: data.bank_code
                });
            });
        }

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// GET: /api/accounts/for-bank - Get non-placeholder accounts for bank dropdown
app.get('/api/accounts/for-bank', (req, res) => {
    try {
        console.log('📊 Fetching accounts for bank dropdown');

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
                CASE WHEN is_placeholder = 1 THEN 0 ELSE 1 END,
                account_code ASC
        `;

        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Accounts for bank error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log(`✅ Found ${results.length} accounts for bank dropdown`);

            // Filter out placeholder accounts (client-side filter)
            const nonPlaceholderAccounts = results.filter(acc => acc.is_placeholder === 0);

            res.json({
                success: true,
                data: results,  // All accounts (client will filter)
                non_placeholder: nonPlaceholderAccounts,
                count: results.length,
                non_placeholder_count: nonPlaceholderAccounts.length
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// ============= ACCOUNTS FOR BANK DROPDOWN (WITH PLACEHOLDERS AS HEADINGS) =============
app.get('/api/accounts/bank-dropdown', (req, res) => {
    try {
        console.log('🏦 Fetching ALL accounts for bank dropdown...');

        // Get ALL active accounts (BOTH placeholder and non-placeholder)
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
                -- First by account code for natural ordering
                CAST(SUBSTRING_INDEX(a.account_code, '-', 1) AS UNSIGNED),
                CASE 
                    WHEN LOCATE('-', a.account_code) > 0 
                    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.account_code, '-', 2), '-', -1) AS UNSIGNED)
                    ELSE 0 
                END,
                CASE 
                    WHEN (LENGTH(a.account_code) - LENGTH(REPLACE(a.account_code, '-', ''))) >= 2
                    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.account_code, '-', 3), '-', -1) AS UNSIGNED)
                    ELSE 0 
                END,
                a.root_level
        `;

        console.log('SQL (ALL accounts including placeholders):', sql);

        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Bank dropdown error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log(`✅ Found ${results.length} TOTAL accounts (including placeholders)`);

            // DEBUG: Show what we got
            console.log('DEBUG - Accounts fetched:');
            results.forEach(acc => {
                console.log(`  ${acc.account_code} - ${acc.account_name} | Placeholder: ${acc.is_placeholder} | Type: ${acc.account_type}`);
            });

            res.json({
                success: true,
                data: results,
                count: results.length
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// GET: /api/banks - Get all banks with pagination
app.get('/api/banks', (req, res) => {
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

        console.log('🏦 Fetching banks with params:', { page, limit, search, account_type, is_default });

        // Base SQL query
        let sql = `
            SELECT 
                b.bank_id,
                b.bank_code,
                b.bank_name,
                b.display_name,
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
                
                -- Chart of Account details
                ca.account_code as chart_account_code,
                ca.account_name as chart_account_name,
                
                -- Currency details
                c.currency_code,
                c.currency_symbol,
                
                -- Address
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

        const params = [];

        // Apply filters
        if (search) {
            sql += ` AND (
                b.bank_code LIKE ? OR 
                b.bank_name LIKE ? OR 
                b.display_name LIKE ? OR
                b.account_number LIKE ?
            )`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (account_type && account_type !== 'All Types') {
            sql += ` AND b.account_type = ?`;
            params.push(account_type);
        }

        if (is_default === 'Default') {
            sql += ` AND b.is_default = 1`;
        } else if (is_default === 'Non-Default') {
            sql += ` AND b.is_default = 0`;
        }

        // Count total
        const countSql = `SELECT COUNT(*) as total FROM (${sql}) as filtered`;

        // Add sorting and pagination
        sql += ` 
            ORDER BY 
                b.is_default DESC,
                b.${sort_by} ${sort_order},
                b.bank_code ASC
            LIMIT ? OFFSET ?
        `;

        params.push(parseInt(limit), parseInt(offset));

        console.log('Banks SQL Query:', sql);

        // Get total count
        db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
            if (countErr) {
                console.error('❌ Banks count error:', countErr);
                return res.status(500).json({
                    success: false,
                    error: countErr.message
                });
            }

            const total = countResult[0]?.total || 0;

            // Get data
            db.query(sql, params, (err, results) => {
                if (err) {
                    console.error('❌ Banks fetch error:', err);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }

                console.log(`✅ Found ${results.length} banks, total: ${total}`);

                res.json({
                    success: true,
                    data: results,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total,
                        total_pages: Math.ceil(total / limit)
                    }
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.get('/api/banks/:id', (req, res) => {
    try {
        const bankId = req.params.id;

        console.log(`🏦 Getting bank details ID: ${bankId}`);

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
            WHERE b.bank_id = ?
        `;

        db.query(sql, [bankId], (err, results) => {
            if (err) {
                console.error('❌ Bank details error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Bank not found'
                });
            }

            res.json({
                success: true,
                data: results[0]
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// PUT: /api/banks/:id - Update bank
app.put('/api/banks/:id', (req, res) => {
    try {
        const bankId = req.params.id;
        const updateData = req.body;

        console.log(`✏️ Updating bank ID: ${bankId}`, updateData);

        // Validation
        if (!updateData.bank_name) {
            return res.status(400).json({
                success: false,
                error: 'Bank name is required'
            });
        }

        if (!updateData.chart_account_id) {
            return res.status(400).json({
                success: false,
                error: 'Chart of account is required'
            });
        }

        if (!updateData.currency_id) {
            return res.status(400).json({
                success: false,
                error: 'Currency is required'
            });
        }

        // Check if setting as default
        if (updateData.is_default) {
            const unsetDefaultSql = 'UPDATE banks SET is_default = 0 WHERE is_default = 1';
            db.query(unsetDefaultSql, (unsetErr) => {
                if (unsetErr) console.error('Unset default error:', unsetErr);
                performUpdate();
            });
        } else {
            performUpdate();
        }

        function performUpdate() {
            const finalUpdateData = {
                bank_name: updateData.bank_name,
                display_name: updateData.display_name,
                account_number: updateData.account_number,
                beneficiary_name: updateData.beneficiary_name,
                phone_number: updateData.phone_number,
                branch_code: updateData.branch_code,
                swift_code: updateData.swift_code,
                ifsc_code: updateData.ifsc_code,
                account_type: updateData.account_type,
                file_format: updateData.file_format,
                chart_account_id: updateData.chart_account_id,
                address1: updateData.address1,
                address2: updateData.address2,
                address3: updateData.address3,
                city: updateData.city,
                country: updateData.country,
                postal_code: updateData.postal_code,
                currency_id: updateData.currency_id,
                is_active: updateData.is_active !== undefined ? updateData.is_active : true,
                is_default: updateData.is_default || false,
                updated_by: 'admin',
                updated_at: new Date()
            };

            const updateSql = 'UPDATE banks SET ? WHERE bank_id = ?';

            db.query(updateSql, [finalUpdateData, bankId], (updateErr, result) => {
                if (updateErr) {
                    console.error('❌ Bank update error:', updateErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Database error: ' + updateErr.message
                    });
                }

                if (result.affectedRows === 0) {
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
            });
        }

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
app.delete('/api/banks/:id/hard', (req, res) => {
    try {
        const bankId = req.params.id;

        console.log(`💀 HARD DELETE requested for bank ID: ${bankId}`);

        // 1. Check if bank exists
        const checkSql = `SELECT bank_id, bank_code, bank_name, is_default FROM banks WHERE bank_id = ?`;

        db.query(checkSql, [bankId], (checkErr, checkResult) => {
            if (checkErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Bank not found'
                });
            }

            const bank = checkResult[0];

            // 2. Check if it's default bank
            if (bank.is_default) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot delete default bank. Set another bank as default first.'
                });
            }

            // 3. Check if bank has any transactions (optional safety check)
            // You might want to add this check if you have transactions table

            // 4. PERMANENT DELETE
            const deleteSql = `DELETE FROM banks WHERE bank_id = ?`;

            db.query(deleteSql, [bankId], (deleteErr, deleteResult) => {
                if (deleteErr) {
                    return res.status(500).json({
                        success: false,
                        error: 'Delete failed: ' + deleteErr.message
                    });
                }

                console.log(`✅ Bank "${bank.bank_code}" permanently deleted from database`);

                res.json({
                    success: true,
                    message: `Bank "${bank.bank_code} - ${bank.bank_name}" permanently deleted`,
                    deleted_bank: bank
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// =============== JOURNAL TYPES APIs ===============

// POST: /api/journal-types - Create new journal type
app.post('/api/journal-types', (req, res) => {
    try {
        const journalTypeData = req.body;
        console.log('📝 Creating journal type:', journalTypeData);

        // Validation
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

        // Check duplicate code
        const checkSql = 'SELECT journal_type_id FROM journal_types WHERE journal_type_code = ?';

        db.query(checkSql, [journalTypeData.journal_type_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error'
                });
            }

            if (checkResult.length > 0) {
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
                is_active: journalTypeData.is_active ? 1 : 0,
                is_expense: journalTypeData.is_expense ? 1 : 0,
                created_by: 'admin',
                updated_by: 'admin'
            };

            const insertSql = 'INSERT INTO journal_types SET ?';

            db.query(insertSql, insertData, (insertErr, result) => {
                if (insertErr) {
                    console.error('❌ Insert error:', insertErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create journal type'
                    });
                }

                console.log(`✅ Journal type created: ${journalTypeData.journal_type_code}`);

                res.status(201).json({
                    success: true,
                    message: 'Journal type created successfully',
                    journal_type_id: result.insertId,
                    journal_type_code: journalTypeData.journal_type_code,
                    journal_type_name: journalTypeData.journal_type_name
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});
// GET: /api/accounts/for-dropdown - Get accounts for dropdown (NON-placeholder only)
app.get('/api/accounts/for-dropdown', (req, res) => {
    try {
        console.log('📊 Fetching accounts for dropdown (non-placeholder only)');

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
              AND a.is_placeholder = 0  -- NON-PLACEHOLDER ONLY
            ORDER BY 
                a.account_type,
                a.account_code ASC
        `;

        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Dropdown accounts error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log(`✅ Found ${results.length} non-placeholder accounts for dropdown`);

            res.json({
                success: true,
                data: results,
                count: results.length
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET: /api/accounts/with-placeholders - Get ALL accounts with placeholders for grouping
app.get('/api/accounts/with-placeholders', (req, res) => {
    try {
        console.log('📊 Fetching ALL accounts with placeholders');

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
                a.is_placeholder DESC,  -- Placeholders first
                a.account_code ASC
        `;

        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ All accounts error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log(`✅ Found ${results.length} total accounts`);

            res.json({
                success: true,
                data: results,
                count: results.length
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// =============== JOURNAL TYPES MANAGEMENT APIs ===============

// GET: /api/journal-types - Get all journal types with pagination
app.get('/api/journal-types', (req, res) => {
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

        console.log('📋 Fetching journal types with params:', {
            page, limit, search, account_id, is_expense, is_active
        });

        // Base SQL query
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

        const params = [];

        // Apply filters
        if (search) {
            sql += ` AND (jt.journal_type_code LIKE ? OR jt.journal_type_name LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        if (account_id && account_id !== 'ALL') {
            sql += ` AND jt.chart_account_id = ?`;
            params.push(account_id);
        }

        if (is_expense !== '') {
            sql += ` AND jt.is_expense = ?`;
            params.push(is_expense === 'true' ? 1 : 0);
        }

        if (is_active !== '') {
            sql += ` AND jt.is_active = ?`;
            params.push(is_active === 'true' ? 1 : 0);
        }

        // Count total
        const countSql = `SELECT COUNT(*) as total FROM (${sql}) as filtered`;

        // Order and limit
        sql += ` 
            ORDER BY jt.created_at DESC
            LIMIT ? OFFSET ?
        `;

        params.push(parseInt(limit), parseInt(offset));

        console.log('SQL Query:', sql);

        // Get total count
        db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
            if (countErr) {
                console.error('❌ Count error:', countErr);
                return res.status(500).json({
                    success: false,
                    error: countErr.message
                });
            }

            const total = countResult[0]?.total || 0;

            // Get data
            db.query(sql, params, (err, results) => {
                if (err) {
                    console.error('❌ Fetch error:', err);
                    return res.status(500).json({
                        success: false,
                        error: err.message
                    });
                }

                console.log(`✅ Found ${results.length} journal types, total: ${total}`);

                res.json({
                    success: true,
                    data: results,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total,
                        total_pages: Math.ceil(total / limit)
                    }
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET: /api/journal-types/:id - Get single journal type
app.get('/api/journal-types/:id', (req, res) => {
    try {
        const journalTypeId = req.params.id;

        console.log(`📋 Getting journal type ID: ${journalTypeId}`);

        const sql = `
            SELECT 
                jt.*,
                a.account_code,
                a.account_name,
                c.currency_code
            FROM journal_types jt
            LEFT JOIN chart_of_accounts a ON jt.chart_account_id = a.account_id
            LEFT JOIN currencies c ON a.currency_id = c.currency_id
            WHERE jt.journal_type_id = ?
        `;

        db.query(sql, [journalTypeId], (err, results) => {
            if (err) {
                console.error('❌ Fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Journal type not found'
                });
            }

            res.json({
                success: true,
                data: results[0]
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// DELETE: /api/journal-types/:id - Delete journal type
app.delete('/api/journal-types/:id', (req, res) => {
    try {
        const journalTypeId = req.params.id;

        console.log(`🗑️ Deleting journal type ID: ${journalTypeId}`);

        const sql = 'DELETE FROM journal_types WHERE journal_type_id = ?';

        db.query(sql, [journalTypeId], (err, result) => {
            if (err) {
                console.error('❌ Delete error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (result.affectedRows === 0) {
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
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET: /api/accounts/for-journal-filter - Get accounts for filter dropdown
app.get('/api/accounts/for-journal-filter', (req, res) => {
    try {
        console.log('📊 Fetching accounts for journal filter...');

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

        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Accounts filter error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log(`✅ Found ${results.length} accounts for filter`);

            res.json({
                success: true,
                data: results
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.put('/api/journal-types/:id', (req, res) => {
    try {
        const journalTypeId = req.params.id;
        const updateData = req.body;

        console.log(`📝 Updating journal type ID: ${journalTypeId}`, updateData);

        // Validation
        const errors = [];
        if (!updateData.journal_type_name) errors.push('Name is required');
        if (!updateData.chart_account_id) errors.push('Chart Account is required');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // Check if exists
        const checkSql = 'SELECT journal_type_id FROM journal_types WHERE journal_type_id = ?';

        db.query(checkSql, [journalTypeId], (checkErr, checkResult) => {
            if (checkErr) throw checkErr;

            if (checkResult.length === 0) {
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
                is_active: updateData.is_active ? 1 : 0,
                is_expense: updateData.is_expense ? 1 : 0,
                updated_by: updateData.updated_by || 'admin',
                updated_at: new Date()
            };

            // Update in database
            const updateSql = 'UPDATE journal_types SET ? WHERE journal_type_id = ?';

            db.query(updateSql, [finalUpdateData, journalTypeId], (updateErr, updateResult) => {
                if (updateErr) {
                    console.error('❌ Update error:', updateErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Database error: ' + updateErr.message
                    });
                }

                console.log(`✅ Journal type ${journalTypeId} updated successfully`);

                res.json({
                    success: true,
                    message: 'Journal type updated successfully',
                    journal_type_id: journalTypeId
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// =============== FORECAST SETTINGS APIs ===============
// GET: /api/forecast-settings
// Add this to server.txt - CORRECTED VERSION

// GET: /api/forecast-settings with pagination and filters
app.get('/api/forecast-settings', (req, res) => {
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

        console.log('📊 Fetching forecast settings with filters:', req.query);

        // Build WHERE conditions dynamically
        let whereConditions = [];
        let params = [];

        if (search) {
            whereConditions.push('(fs.forecast_name LIKE ? OR fs.description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        if (forecast_type && forecast_type !== 'All Types') {
            whereConditions.push('fs.forecast_type = ?');
            params.push(forecast_type);
        }

        if (forecast_model && forecast_model !== 'All Models') {
            whereConditions.push('fs.forecast_model = ?');
            params.push(forecast_model);
        }

        if (expense_type && expense_type !== 'All Types') {
            whereConditions.push('fs.expense_type = ?');
            params.push(expense_type);
        }

        // Construct WHERE clause
        let whereClause = whereConditions.length > 0
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';

        // Base SQL query
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
            LIMIT ? OFFSET ?
        `;

        // Add pagination parameters
        params.push(parseInt(limit), parseInt(offset));

        console.log('SQL Query:', sql);
        console.log('Parameters:', params);

        // Count total records
        const countSql = `
            SELECT COUNT(*) as total
            FROM forecast_settings fs
            ${whereClause}
        `;

        console.log('Count SQL:', countSql);

        // First get total count
        db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
            if (countErr) {
                console.error('❌ Count error:', countErr);
                return res.status(500).json({
                    success: false,
                    error: 'Count query failed: ' + countErr.message
                });
            }

            const total = countResult[0]?.total || 0;

            // Then get data
            db.query(sql, params, (err, results) => {
                if (err) {
                    console.error('❌ Data fetch error:', err);
                    return res.status(500).json({
                        success: false,
                        error: 'Data fetch failed: ' + err.message
                    });
                }

                console.log(`✅ Found ${results.length} forecast settings, total: ${total}`);

                res.json({
                    success: true,
                    data: results,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total,
                        total_pages: Math.ceil(total / limit)
                    }
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// POST: /api/forecast-settings
app.post('/api/forecast-settings', (req, res) => {
    const forecastData = req.body;

    // Get account details if account_id is provided
    if (forecastData.account_id) {
        const accountSql = 'SELECT account_code, account_name FROM chart_of_accounts WHERE account_id = ?';
        db.query(accountSql, [forecastData.account_id], (accountErr, accountResult) => {
            if (!accountErr && accountResult.length > 0) {
                forecastData.account_code = accountResult[0].account_code;

            }
            insertForecast();
        });
    } else {
        insertForecast();
    }

    function insertForecast() {
        const sql = 'INSERT INTO forecast_settings SET ?';

        db.query(sql, forecastData, (err, result) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }

            res.status(201).json({
                success: true,
                message: 'Forecast setting created successfully',
                forecast_id: result.insertId
            });
        });
    }
});
app.get('/api/accounts/income', (req, res) => {
    console.log('📊 Fetching income accounts for forecast...');

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
          AND is_placeholder = 0  -- Only actual accounts, not placeholders
        ORDER BY account_code ASC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Income accounts error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log(`✅ Found ${results.length} income accounts`);

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
// GET: /api/forecast-settings with pagination and filters
app.get('/api/forecast-settings/:id', (req, res) => {
    try {
        const forecastId = req.params.id;

        console.log(`📋 Getting details for forecast ID: ${forecastId}`);

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
            WHERE fs.forecast_id = ?
        `;

        db.query(sql, [forecastId], (err, results) => {
            if (err) {
                console.error('❌ Forecast details error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Forecast setting not found'
                });
            }

            const forecast = results[0];

            res.json({
                success: true,
                data: forecast
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// PUT: /api/forecast-settings/:id - Update forecast
app.put('/api/forecast-settings/:id', (req, res) => {
    try {
        const forecastId = req.params.id;
        const updateData = req.body;

        console.log(`📝 Updating forecast ID: ${forecastId}`, updateData);

        // Validate required fields

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

        // Check if forecast exists
        const checkSql = 'SELECT forecast_id FROM forecast_settings WHERE forecast_id = ?';

        db.query(checkSql, [forecastId], (checkErr, checkResult) => {
            if (checkErr) throw checkErr;

            if (checkResult.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Forecast setting not found'
                });
            }

            // Get account details if account_id is provided
            if (updateData.account_id) {
                const accountSql = 'SELECT account_code, account_name FROM chart_of_accounts WHERE account_id = ?';
                db.query(accountSql, [updateData.account_id], (accountErr, accountResult) => {
                    if (!accountErr && accountResult.length > 0) {
                        updateData.account_code = accountResult[0].account_code;

                    }
                    performUpdate();
                });
            } else {
                updateData.account_code = null;

                performUpdate();
            }

            function performUpdate() {
                // Add timestamp and updated_by
                updateData.updated_at = new Date();
                updateData.updated_by = updateData.updated_by || 'admin';

                // Update forecast
                const updateSql = 'UPDATE forecast_settings SET ? WHERE forecast_id = ?';

                db.query(updateSql, [updateData, forecastId], (updateErr, updateResult) => {
                    if (updateErr) {
                        console.error('❌ Update error:', updateErr);
                        return res.status(500).json({
                            success: false,
                            error: 'Database error: ' + updateErr.message
                        });
                    }

                    console.log(`✅ Forecast "${updateData.forecast_name}" updated successfully`);

                    res.json({
                        success: true,
                        message: 'Forecast updated successfully',
                        forecast_id: forecastId,
                        forecast_name: updateData.forecast_name
                    });
                });
            }
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// DELETE: /api/forecast-settings/:id
app.delete('/api/forecast-settings/:id', (req, res) => {
    const forecastId = req.params.id;

    const sql = 'DELETE FROM forecast_settings WHERE forecast_id = ?';

    db.query(sql, [forecastId], (err, result) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Forecast setting not found'
            });
        }

        res.json({
            success: true,
            message: 'Forecast setting deleted successfully'
        });
    });
});
//======================Petty Cash APIs======================
// GET: /api/petty-cash - Get all petty cash
// ============= PETTY CASH ACCOUNTS API =============

// GET: /api/accounts/petty-cash - Get only petty cash accounts
app.get('/api/accounts/petty-cash', (req, res) => {
    console.log('💰 API: Fetching petty cash accounts');

    // Try different methods to find petty cash accounts
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
            -- Method 1: Check account type
            coa.account_type = 'PETTY_CASH' 
            -- Method 2: Check account name pattern
            OR LOWER(coa.account_name) LIKE '%petty cash%'
            OR LOWER(coa.account_name) LIKE '%petty%cash%'
            -- Method 3: Check account code pattern (common codes for petty cash)
            OR coa.account_code LIKE '110%'
            OR coa.account_code LIKE '111%'
            OR coa.account_code LIKE '112%'
          )
        ORDER BY coa.account_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ API Error - Petty cash accounts:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log(`✅ API: Found ${results.length} petty cash accounts`);

        if (results.length === 0) {
            // If no petty cash accounts found, try to get CASH accounts as fallback
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
                LIMIT 5
            `;

            db.query(fallbackSql, (fallbackErr, fallbackResults) => {
                if (fallbackErr) {
                    return res.status(500).json({
                        success: false,
                        error: fallbackErr.message
                    });
                }

                const formatted = fallbackResults.map(account => ({
                    value: account.account_id,
                    text: `${account.account_code} - ${account.account_name} (CASH)`,
                    balance: account.current_balance,
                    currency: account.currency_code,
                    type: account.account_type
                }));

                res.json({
                    success: true,
                    data: formatted,
                    warning: "No petty cash accounts found. Showing CASH accounts instead."
                });
            });

            return;
        }

        // Format for dropdown
        const formatted = results.map(account => ({
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
            count: results.length
        });
    });
});
// POST: /api/petty-cash/create - Create new petty cash
app.post('/api/petty-cash/create', (req, res) => {
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

        console.log('Request data:', req.body);

        // Validation
        const errors = [];
        if (!petty_cash_code) errors.push('Petty cash code is required');
        if (!petty_cash_name) errors.push('Petty cash name is required');
        if (!account_id) errors.push('Chart of account is required');

        // If approval needed, check approval amount
        if (is_approval_needed && (!approval_amount || approval_amount <= 0)) {
            errors.push('Approval amount must be greater than 0 when approval is needed');
        }

        if (errors.length > 0) {
            console.error('Validation errors:', errors);
            return res.status(400).json({
                success: false,
                error: errors.join(', ')
            });
        }

        // First, get account details
        const accountSql = `
            SELECT account_code, account_name, current_balance 
            FROM chart_of_accounts 
            WHERE account_id = ? AND is_active = 1
        `;

        db.query(accountSql, [account_id], (accountErr, accountResult) => {
            if (accountErr) {
                console.error('Account fetch error:', accountErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + accountErr.message
                });
            }

            if (accountResult.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Selected account not found or inactive'
                });
            }

            const account = accountResult[0];

            // Insert petty cash record
            const insertData = {
                petty_cash_code,
                petty_cash_name,
                description: description || null,
                petty_cash_amount: parseFloat(petty_cash_amount) || 0,
                current_balance: parseFloat(current_balance) || 0,
                max_expenses_allowed: parseFloat(max_expenses_allowed) || 0,
                is_approval_needed: is_approval_needed ? 1 : 0,
                approval_amount: is_approval_needed ? (parseFloat(approval_amount) || 0) : 0,
                handled_by: handled_by || 'Admin',
                account_id,
                account_code: account.account_code,
                account_name: account.account_name,
                created_by: 'admin',
                updated_by: 'admin'
            };

            console.log('Insert data:', insertData);

            const insertSql = 'INSERT INTO petty_cash_master SET ?';

            db.query(insertSql, insertData, (insertErr, result) => {
                if (insertErr) {
                    console.error('Insert error:', insertErr);

                    // Handle duplicate entry
                    if (insertErr.code === 'ER_DUP_ENTRY') {
                        return res.status(409).json({
                            success: false,
                            error: `Petty cash code "${petty_cash_code}" already exists`
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        error: 'Database error: ' + insertErr.message
                    });
                }

                console.log(`✅ API: Petty cash created - ID: ${result.insertId}, Code: ${petty_cash_code}`);

                // Return success response
                res.status(201).json({
                    success: true,
                    message: 'Petty cash created successfully',
                    data: {
                        petty_cash_id: result.insertId,
                        petty_cash_code,
                        petty_cash_name,
                        account_code: account.account_code,
                        account_name: account.account_name,
                        current_balance: insertData.current_balance
                    }
                });
            });
        });

    } catch (error) {
        console.error('❌ API Error - Create petty cash:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// GET: /api/petty-cash/list - Get all petty cash records
app.get('/api/petty-cash/list', (req, res) => {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    console.log('📋 API: Fetching petty cash list');

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

    const params = [];

    // Add search filter
    if (search) {
        sql += ` AND (p.petty_cash_code LIKE ? OR p.petty_cash_name LIKE ? OR p.account_code LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Count total
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) as filtered`;

    // Add ordering and pagination
    sql += ` ORDER BY p.petty_cash_code ASC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    // Get total count
    db.query(countSql, params.slice(0, -2), (countErr, countResult) => {
        if (countErr) {
            console.error('Count error:', countErr);
            return res.status(500).json({
                success: false,
                error: countErr.message
            });
        }

        const total = countResult[0]?.total || 0;

        // Get data
        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('Fetch error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }

            console.log(`✅ API: Found ${results.length} petty cash records`);

            res.json({
                success: true,
                data: results,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    total_pages: Math.ceil(total / limit)
                }
            });
        });
    });
});
// GET: /api/petty-cash/:id - Get petty cash details
app.get('/api/petty-cash/:id', (req, res) => {
    const pettyCashId = req.params.id;

    console.log(`🔍 API: Fetching petty cash details for ID: ${pettyCashId}`);

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
        WHERE p.petty_cash_id = ?
    `;

    db.query(sql, [pettyCashId], (err, results) => {
        if (err) {
            console.error('Details error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Petty cash record not found'
            });
        }

        console.log(`✅ API: Found petty cash record: ${results[0].petty_cash_code}`);

        res.json({
            success: true,
            data: results[0]
        });
    });
});
// PUT: /api/petty-cash/:id - Update petty cash
app.put('/api/petty-cash/:id', (req, res) => {
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
        is_approval_needed: is_approval_needed ? 1 : 0,
        approval_amount: is_approval_needed ? (parseFloat(approval_amount) || 0) : 0,
        handled_by: handled_by || 'Admin',
        description: description || null,
        is_active: is_active ? 1 : 0,
        updated_by: 'admin',
        updated_at: new Date()
    };

    const sql = 'UPDATE petty_cash_master SET ? WHERE petty_cash_id = ?';

    db.query(sql, [updateData, pettyCashId], (err, result) => {
        if (err) {
            console.error('Update error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
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
    });
});

app.delete('/api/petty-cash/:id/hard', (req, res) => {
    const pettyCashId = req.params.id;

    console.log(`💀 HARD DELETE petty cash ID: ${pettyCashId}`);

    // Get details for confirmation message
    const checkSql = `SELECT petty_cash_code, petty_cash_name FROM petty_cash_master WHERE petty_cash_id = ?`;

    db.query(checkSql, [pettyCashId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Petty cash record not found'
            });
        }

        const pettyCash = checkResult[0];

        // PERMANENT DELETE
        const deleteSql = `DELETE FROM petty_cash_master WHERE petty_cash_id = ?`;

        db.query(deleteSql, [pettyCashId], (deleteErr, deleteResult) => {
            if (deleteErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Delete failed: ' + deleteErr.message
                });
            }

            console.log(`✅ Permanently deleted: ${pettyCash.petty_cash_code}`);

            res.json({
                success: true,
                message: `Petty cash "${pettyCash.petty_cash_code} - ${pettyCash.petty_cash_name}" permanently deleted`,
                deleted_code: pettyCash.petty_cash_code,
                warning: 'This action cannot be undone!'
            });
        });
    });
});
//=============================Products====================================================//
// Add to server.js
app.get('/api/products/dropdown-data', (req, res) => {
    console.log('📊 Fetching ALL dropdown data for product form');

    try {
        // Collect all queries
        const queries = {
            vendors: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        vendor_id,
                        CONCAT(vendor_code, ' - ', vendor_name) as display_name,
                        vendor_code,
                        vendor_name
                    FROM vendors 
                    WHERE is_active = 1
                    ORDER BY vendor_name
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            }),

            chartOfAccounts: new Promise((resolve, reject) => {
                // 🔴 FIX: NON-placeholder accounts only
                const sql = `
                    SELECT 
                        account_id,
                        CONCAT(account_code, ' - ', account_name) as display_name,
                        account_code,
                        account_name,
                        account_type,
                        is_placeholder
                    FROM chart_of_accounts 
                    WHERE is_placeholder = 0 
                      AND is_active = 1
                    ORDER BY account_code
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            }),

            departments: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        department_id,
                        department_code,
                        department_name
                    FROM departments 
                    WHERE is_active = 1
                    ORDER BY department_name
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            }),

            categories: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        category_id,
                        CONCAT(category_code, ' - ', category_name) as display_name,
                        category_code,
                        category_name,
                        department_id
                    FROM categories 
                    WHERE is_active = 1
                    ORDER BY category_name
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            }),

            brands: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        brand_id,
                        CONCAT(brand_code, ' - ', brand_name) as display_name,
                        brand_code,
                        brand_name
                    FROM brands 
                    WHERE is_active = 1
                    ORDER BY brand_name
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            }),

            uoms: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        uom_id,
                        CONCAT(uom_code, ' - ', uom_name) as display_name,
                        uom_code,
                        uom_name,
                        is_base_uom
                    FROM uoms 
                    WHERE is_active = 1
                    ORDER BY uom_name
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            })
        };

        // Execute all queries
        Promise.all([
            queries.vendors,
            queries.chartOfAccounts,
            queries.departments,
            queries.categories,
            queries.brands,
            queries.uoms
        ]).then(results => {
            console.log('✅ All dropdown data fetched successfully');

            res.json({
                success: true,
                data: {
                    vendors: results[0],
                    chartOfAccounts: results[1],
                    departments: results[2],
                    categories: results[3],
                    brands: results[4],
                    uoms: results[5]
                }
            });

        }).catch(error => {
            console.error('❌ Dropdown data error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch dropdown data: ' + error.message
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
app.get('/api/chart-of-accounts/non-placeholder', (req, res) => {
    const sql = `
        SELECT 
            account_id,
            CONCAT(account_code, ' - ', account_name) as display_name,
            account_code,
            account_name,
            account_type
        FROM chart_of_accounts 
        WHERE is_placeholder = 0 
          AND is_active = 1
        ORDER BY account_code
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Non-placeholder accounts error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        console.log(`✅ Found ${results.length} non-placeholder accounts`);

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
app.get('/api/departments/active', (req, res) => {
    const sql = `
        SELECT 
            department_id,
            department_code,
            department_name
        FROM departments 
        WHERE is_active = 1
        ORDER BY department_name
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Active departments error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results
        });
    });
});
app.post('/api/products', (req, res) => {
    try {
        const productData = req.body;

        console.log('📦 Creating product:', productData.product_code);

        // Validation
        if (!productData.product_code || !productData.product_name) {
            return res.status(400).json({
                success: false,
                error: 'Product code and name are required'
            });
        }

        // Check if product code exists
        const checkSql = 'SELECT product_id FROM product WHERE product_code = ?';

        db.query(checkSql, [productData.product_code], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('❌ Product check error:', checkErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Product code "${productData.product_code}" already exists`
                });
            }

            // 🔴 FIX: Get actual user ID or use NULL
            let createdById = productData.created_by;

            // Check if user exists
            const userCheckSql = 'SELECT user_id FROM users WHERE user_id = ?';
            db.query(userCheckSql, [createdById], (userErr, userResult) => {
                if (userErr || userResult.length === 0) {
                    console.log('⚠️ User not found, setting created_by to NULL');
                    createdById = null;
                }

                // Set defaults with safe created_by
                const defaults = {
                    current_stock: 0.00,
                    selling_price: 0.00,
                    avg_cost: 0.00,
                    lp_price: 0.00,
                    base_weight: 0.00,
                    base_weight_unit: 'KG',
                    is_active: true,
                    created_at: new Date(),
                    created_by: createdById  // Use checked value
                };

                // Merge with product data
                const finalData = { ...defaults, ...productData };

                // 🔴 FIX: Ensure created_by is safe
                finalData.created_by = createdById;

                console.log('📋 Final product data:', finalData);

                // Insert product WITHOUT created_by if it causes issues
                const safeData = { ...finalData };

                // If created_by is invalid, set to NULL
                if (!safeData.created_by || safeData.created_by <= 0) {
                    safeData.created_by = null;
                }

                const insertSql = 'INSERT INTO product SET ?';

                db.query(insertSql, safeData, (insertErr, result) => {
                    if (insertErr) {
                        console.error('❌ Product create error:', insertErr);

                        // Try again without created_by
                        if (insertErr.code === 'ER_NO_REFERENCED_ROW_2') {
                            delete safeData.created_by;

                            db.query(insertSql, safeData, (retryErr, retryResult) => {
                                if (retryErr) {
                                    return res.status(500).json({
                                        success: false,
                                        error: 'Foreign key constraint failed: ' + retryErr.message
                                    });
                                }

                                console.log(`✅ Product created (without created_by): ${productData.product_code}`);

                                res.status(201).json({
                                    success: true,
                                    message: 'Product created successfully',
                                    product_id: retryResult.insertId,
                                    product_code: productData.product_code,
                                    warning: 'Created without user reference'
                                });
                            });
                        } else {
                            return res.status(500).json({
                                success: false,
                                error: 'Failed to create product: ' + insertErr.message
                            });
                        }
                    } else {
                        console.log(`✅ Product created: ${productData.product_code} (ID: ${result.insertId})`);

                        res.status(201).json({
                            success: true,
                            message: 'Product created successfully',
                            product_id: result.insertId,
                            product_code: productData.product_code
                        });
                    }
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
app.post('/api/products/:id/images', (req, res) => {
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

        // Check if product exists
        const checkSql = 'SELECT product_id FROM product WHERE product_id = ?';

        db.query(checkSql, [productId], (checkErr, checkResult) => {
            if (checkErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Product not found'
                });
            }

            // Insert image
            const imageSql = 'INSERT INTO product_image SET ?';
            const imageRecord = {
                product_id: productId,
                image_type: imageData.image_type || 'GALLERY',
                image_data: imageData.image_data,  // Base64 string
                image_name: imageData.image_name || 'product_image.jpg',
                image_size: imageData.image_size || 0,
                mime_type: imageData.mime_type || 'image/jpeg',
                display_order: imageData.display_order || 0,
                created_at: new Date()
            };

            db.query(imageSql, imageRecord, (imageErr, imageResult) => {
                if (imageErr) {
                    console.error('❌ Image upload error:', imageErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to upload image: ' + imageErr.message
                    });
                }

                console.log(`✅ Image uploaded for product ID: ${productId}`);

                res.status(201).json({
                    success: true,
                    message: 'Image uploaded successfully',
                    image_id: imageResult.insertId
                });
            });
        });

    } catch (error) {
        console.error('❌ Image upload server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
// ============================= PRODUCTS LISTING =============================
app.get('/api/products', (req, res) => {
    const {
        page = 1,
        limit = 20,
        search = '',
        department_id = '',
        category_id = '',
        brand_id = ''
    } = req.query;

    const offset = (page - 1) * limit;

    let whereClauses = ['p.is_active = 1'];
    let params = [];

    if (search) {
        whereClauses.push('(p.product_code LIKE ? OR p.product_name LIKE ? OR p.alias LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (department_id) {
        whereClauses.push('p.department_id = ?');
        params.push(department_id);
    }

    if (category_id) {
        whereClauses.push('p.category_id = ?');
        params.push(category_id);
    }

    if (brand_id) {
        whereClauses.push('p.brand_id = ?');
        params.push(brand_id);
    }

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // Get total count
    const countSQL = `
        SELECT COUNT(*) as total 
        FROM product p
        ${whereSQL}
    `;

    // Get data with joins
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
            
            (SELECT image_path FROM product_image 
             WHERE product_id = p.product_id AND image_type = 'MAIN' LIMIT 1) as main_image
            
        FROM product p
        LEFT JOIN departments d ON p.department_id = d.department_id
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN brands b ON p.brand_id = b.brand_id
        LEFT JOIN uoms u ON p.uom_id = u.uom_id
        LEFT JOIN vendors v ON p.vendor_id = v.vendor_id
        ${whereSQL}
        ORDER BY p.product_code ASC
        LIMIT ? OFFSET ?
    `;

    db.query(countSQL, params, (countErr, countResult) => {
        if (countErr) {
            console.error('Count error:', countErr);
            return res.status(500).json({ success: false, error: countErr.message });
        }

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        db.query(dataSQL, [...params, parseInt(limit), parseInt(offset)], (dataErr, dataResult) => {
            if (dataErr) {
                console.error('Data error:', dataErr);
                return res.status(500).json({ success: false, error: dataErr.message });
            }

            console.log(`✅ Products fetched: ${dataResult.length} of ${total}`);

            res.json({
                success: true,
                data: dataResult,
                pagination: {
                    current_page: parseInt(page),
                    total_pages: totalPages,
                    total_items: total,
                    items_per_page: parseInt(limit),
                    has_next: page < totalPages,
                    has_prev: page > 1
                }
            });
        });
    });
});

// ============================= DELETE PRODUCT =============================
app.delete('/api/products/:id', (req, res) => {
    const productId = req.params.id;

    const sql = 'DELETE FROM product WHERE product_id = ?';

    db.query(sql, [productId], (err, result) => {
        if (err) {
            console.error('❌ Delete error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
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
    });
});

// ============================= UPDATE PRODUCT =============================
app.put('/api/products/:id', (req, res) => {
    const productId = req.params.id;
    const productData = req.body;

    // Check if product exists
    const checkSql = 'SELECT product_id FROM product WHERE product_id = ?';

    db.query(checkSql, [productId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        // Update product
        const updateSql = 'UPDATE product SET ? WHERE product_id = ?';

        db.query(updateSql, [productData, productId], (updateErr, updateResult) => {
            if (updateErr) {
                console.error('❌ Update error:', updateErr);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to update product: ' + updateErr.message
                });
            }

            console.log(`✅ Product updated: ID ${productId}`);

            res.json({
                success: true,
                message: 'Product updated successfully'
            });
        });
    });
});

// ============================= GET SINGLE PRODUCT =============================
app.get('/api/products/:id', (req, res) => {
    const productId = req.params.id;

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
        WHERE p.product_id = ?
    `;

    db.query(sql, [productId], (err, result) => {
        if (err) {
            console.error('❌ Fetch error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        res.json({
            success: true,
            data: result[0]
        });
    });
});
// ============================= GET PRODUCT IMAGES =============================
app.get('/api/products/:id/images', (req, res) => {
    const productId = req.params.id;

    const sql = `
        SELECT * FROM product_image 
        WHERE product_id = ? 
        ORDER BY display_order, created_at
    `;

    db.query(sql, [productId], (err, results) => {
        if (err) {
            console.error('❌ Get images error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            data: results,
            count: results.length
        });
    });
});
// ============================= SERVICES API =============================

// GET: Services dropdown data
app.get('/api/services/dropdown-data', (req, res) => {
    console.log('📊 Fetching ALL dropdown data for service form');

    try {
        const queries = {
            departments: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        department_id, 
                        CONCAT(department_code, ' - ', department_name) as display_name,
                        department_code,
                        department_name
                    FROM departments 
                    WHERE is_active = 1
                    ORDER BY department_code
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err); else resolve(results);
                });
            }),

            categories: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        category_id, 
                        CONCAT(category_code, ' - ', category_name) as display_name,
                        category_code,
                        category_name
                    FROM categories 
                    WHERE is_active = 1
                    ORDER BY category_code
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err); else resolve(results);
                });
            }),

            vendors: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        vendor_id, 
                        CONCAT(vendor_code, ' - ', vendor_name) as display_name,
                        vendor_code,
                        vendor_name
                    FROM vendors 
                    WHERE is_active = 1
                    ORDER BY vendor_code
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err); else resolve(results);
                });
            }),

            uoms: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        uom_id, 
                        CONCAT(uom_code, ' - ', uom_name) as display_name,
                        uom_code,
                        uom_name
                    FROM uoms 
                    WHERE is_active = 1
                    ORDER BY uom_code
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err); else resolve(results);
                });
            }),

            currencies: new Promise((resolve, reject) => {
                const sql = `
                    SELECT 
                        currency_id, 
                        CONCAT(currency_code, ' - ', currency_name) as display_name,
                        currency_code,
                        currency_name,
                        currency_symbol
                    FROM currencies 
                    WHERE is_active = 1
                    ORDER BY currency_code
                `;
                db.query(sql, (err, results) => {
                    if (err) reject(err); else resolve(results);
                });
            })
        };

        Promise.all([
            queries.departments,
            queries.categories,
            queries.vendors,
            queries.uoms,
            queries.currencies
        ]).then(results => {
            console.log(`✅ Dropdown data loaded:`);
            console.log(`   Departments: ${results[0].length}`);
            console.log(`   Categories: ${results[1].length}`);
            console.log(`   Vendors: ${results[2].length}`);
            console.log(`   UOMs: ${results[3].length}`);
            console.log(`   Currencies: ${results[4].length}`);

            res.json({
                success: true,
                data: {
                    departments: results[0],
                    categories: results[1],
                    vendors: results[2],
                    uoms: results[3],
                    currencies: results[4]
                }
            });
        }).catch(error => {
            console.error('❌ Dropdown data error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch dropdown data: ' + error.message
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// POST: Create new service
app.post('/api/services', (req, res) => {
    try {
        const serviceData = req.body;

        console.log('🔧 Creating service:', serviceData.service_code);

        // Validation
        if (!serviceData.service_code || !serviceData.service_name) {
            return res.status(400).json({
                success: false,
                error: 'Service code and name are required'
            });
        }

        // Check if service code exists
        const checkSql = 'SELECT service_id FROM services WHERE service_code = ?';

        db.query(checkSql, [serviceData.service_code], (checkErr, checkResult) => {
            if (checkErr) {
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + checkErr.message
                });
            }

            if (checkResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Service code "${serviceData.service_code}" already exists`
                });
            }

            // Set defaults
            const defaults = {
                unit_price: 0.00,
                is_expense: false,
                is_active: true,
                created_at: new Date()
            };

            const finalData = { ...defaults, ...serviceData };

            // Insert service
            const insertSql = 'INSERT INTO services SET ?';

            db.query(insertSql, finalData, (err, result) => {
                if (err) {
                    console.error('❌ Service create error:', err);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create service: ' + err.message
                    });
                }

                console.log(`✅ Service created: ${serviceData.service_code} (ID: ${result.insertId})`);

                res.status(201).json({
                    success: true,
                    message: 'Service created successfully',
                    service_id: result.insertId,
                    service_code: serviceData.service_code
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// GET: All services with pagination
app.get('/api/services', (req, res) => {
    const {
        page = 1,
        limit = 20,
        search = '',
        department_id = '',
        category_id = ''
    } = req.query;

    const offset = (page - 1) * limit;

    let whereClauses = ['s.is_active = 1'];
    let params = [];

    if (search) {
        whereClauses.push('(s.service_code LIKE ? OR s.service_name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
    }

    if (department_id) {
        whereClauses.push('s.department_id = ?');
        params.push(department_id);
    }

    if (category_id) {
        whereClauses.push('s.category_id = ?');
        params.push(category_id);
    }

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // Get total count
    const countSQL = `SELECT COUNT(*) as total FROM services s ${whereSQL}`;

    // Get data with joins
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
        LIMIT ? OFFSET ?
    `;

    db.query(countSQL, params, (countErr, countResult) => {
        if (countErr) {
            return res.status(500).json({ success: false, error: countErr.message });
        }

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        db.query(dataSQL, [...params, parseInt(limit), parseInt(offset)], (dataErr, dataResult) => {
            if (dataErr) {
                return res.status(500).json({ success: false, error: dataErr.message });
            }

            res.json({
                success: true,
                data: dataResult,
                pagination: {
                    current_page: parseInt(page),
                    total_pages: totalPages,
                    total_items: total,
                    items_per_page: parseInt(limit),
                    has_next: page < totalPages,
                    has_prev: page > 1
                }
            });
        });
    });
});

// GET: Single service
app.get('/api/services/:id', (req, res) => {
    const serviceId = req.params.id;

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
        WHERE s.service_id = ?
    `;

    db.query(sql, [serviceId], (err, result) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        res.json({
            success: true,
            data: result[0]
        });
    });
});

// PUT: Update service
app.put('/api/services/:id', (req, res) => {
    const serviceId = req.params.id;
    const serviceData = req.body;

    // Check if service exists
    const checkSql = 'SELECT service_id FROM services WHERE service_id = ?';

    db.query(checkSql, [serviceId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: 'Database error: ' + checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        // Add updated timestamp
        serviceData.updated_at = new Date();

        // Update service
        const updateSql = 'UPDATE services SET ? WHERE service_id = ?';

        db.query(updateSql, [serviceData, serviceId], (updateErr, updateResult) => {
            if (updateErr) {
                console.error('❌ Update error:', updateErr);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to update service: ' + updateErr.message
                });
            }

            res.json({
                success: true,
                message: 'Service updated successfully'
            });
        });
    });
});

// DELETE: Delete service
app.delete('/api/services/:id', (req, res) => {
    const serviceId = req.params.id;

    const sql = 'DELETE FROM services WHERE service_id = ?';

    db.query(sql, [serviceId], (err, result) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        res.json({
            success: true,
            message: 'Service deleted successfully'
        });
    });
});
// saveInvoiceItems function 
function saveInvoiceItems(invoiceId, invoiceData, res) {
    console.log(`💾 Saving ${invoiceData.items.length} items for invoice ${invoiceId}`);
    
    if (!invoiceData.items || invoiceData.items.length === 0) {
        return res.json({
            success: true,
            data: { invoice_id: invoiceId, invoice_no: invoiceData.invoice_no }
        });
    }
    
    const itemPromises = invoiceData.items.map(item => {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO purchase_invoice_items 
                (invoice_id, item_type, reference_item_id, item_code, 
                 item_name, quantity, unit_price, total_amount, uom)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const values = [
                invoiceId,
                item.item_type || 'product',
                item.reference_item_id || 0,
                item.item_code || '',
                item.item_name || 'Item',
                item.quantity || 1,
                item.unit_price || 0,
                item.total_amount || 0,
                item.uom || 'PCS'
            ];
            
            db.query(sql, values, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
    });
    
    Promise.all(itemPromises)
        .then(() => {
            console.log(`✅ All items saved for invoice ${invoiceId}`);
            res.json({
                success: true,
                data: { 
                    invoice_id: invoiceId, 
                    invoice_no: invoiceData.invoice_no,
                    message: 'Invoice saved successfully'
                }
            });
        })
        .catch(error => {
            console.error('❌ Failed to save items:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save invoice items: ' + error.message
            });
        });
}
//=============Purchase Invoices API=================
// POST /api/purchase-invoices
app.post('/api/purchase-invoices', (req, res) => {
    console.log('📥 Invoice save request received');
    
    try {
        // Calculate payment fields
        const paidAmount = req.body.paid_amount || 0;
        const grandTotal = req.body.grand_total || 0;
        const balanceAmount = req.body.balance_amount || (grandTotal - paidAmount);
        
        // Determine payment status
        let paymentStatus = 'new';
    if (req.body.due_date) {
        const dueDate = new Date(req.body.due_date);
        const today = new Date();
        
        // If due date is in past, set as overdue
        if (dueDate < today) {
            paymentStatus = 'overdue';
        }
    }

        // Extract MINIMAL required data first
        const invoiceData = {
            // ============ REQUIRED FIELDS ============
            vendor_id: req.body.vendor_id || 1,
            invoice_no: req.body.invoice_no || `INV-${Date.now()}`,
            transaction_no: req.body.transaction_no || '',
            invoice_date: req.body.invoice_date || new Date().toISOString().split('T')[0],
            transaction_date: req.body.transaction_date || new Date().toISOString().split('T')[0],
            
            // ============ OPTIONAL FIELDS ============
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
            
            // ============ NEW FIELDS ============
            invoice_type: req.body.invoice_type || 'Invoice',
            permit_no: req.body.permit_no || '',
            bill_of_lading_no: req.body.bill_of_lading_no || '',
            container_no: req.body.container_no || '',
            profit_reference: req.body.profit_reference || '',
            
            // ============ PAYMENT FIELDS ============
            payment_status: paymentStatus,
            paid_amount: paidAmount,
            balance_amount: balanceAmount,
            
            items: req.body.items || []
        };
        
        console.log('🔍 Invoice data prepared:', {
            grandTotal,
            paidAmount,
            balanceAmount,
            paymentStatus
        });
        
        // ============ VALIDATION ============
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
        
        // ============ SIMPLIFIED SQL ============
        const simpleSQL = `
            INSERT INTO purchase_invoices 
            (
                vendor_id, invoice_no, transaction_no, 
                invoice_date, transaction_date, due_date, expected_payment_date,
                currency_id, currency_rate, gst_type, gst_value,
                terms, po_no, reference_no, project_id,
                add_to_project_costing, discount_type, discount_value,
                subtotal, discount_amount, gst_amount, fc_amount, grand_total,
                status, remarks, created_by, 
                permit_no, bill_of_lading_no, container_no,
                profit_reference, invoice_type,
                payment_status, paid_amount, balance_amount,
                created_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?,      -- 7 values
                ?, ?, ?, ?,               -- 4 values
                ?, ?, ?, ?,               -- 4 values
                ?, ?, ?,                  -- 3 values
                ?, ?, ?, ?, ?,            -- 5 values
                ?, ?, ?,                  -- 3 values
                ?, ?, ?, ?, ?,            -- 5 values
                ?, ?, ?,                  -- 3 payment values
                NOW()                     -- created_at
            )
        `;
            
        const simpleValues = [
            // Vendor & Dates (7)
            invoiceData.vendor_id,
            invoiceData.invoice_no,
            invoiceData.transaction_no,
            invoiceData.invoice_date,
            invoiceData.transaction_date,
            invoiceData.due_date,
            invoiceData.expected_payment_date,
            
            // Currency & GST (4)
            invoiceData.currency_id,
            invoiceData.currency_rate,
            invoiceData.gst_type,
            invoiceData.gst_value,
            
            // References (4)
            invoiceData.terms,
            invoiceData.po_no,
            invoiceData.reference_no,
            invoiceData.project_id,
            
            // Costing & Discount (3)
            invoiceData.add_to_project_costing,
            invoiceData.discount_type,
            invoiceData.discount_value,
            
            // Amounts (5)
            invoiceData.subtotal,
            invoiceData.discount_amount,
            invoiceData.gst_amount,
            invoiceData.fc_amount,
            invoiceData.grand_total,
            
            // Status & Info (3)
            invoiceData.status,
            invoiceData.remarks,
            invoiceData.created_by,
            
            // Extra Fields (5)
            invoiceData.permit_no,
            invoiceData.bill_of_lading_no,
            invoiceData.container_no,
            invoiceData.profit_reference,
            invoiceData.invoice_type,
            
            // Payment Fields (3)
            invoiceData.payment_status,
            invoiceData.paid_amount,
            invoiceData.balance_amount
        ];
            
        console.log(`🔢 Simple SQL: ${simpleValues.length} values`);
        
        // Execute
        db.query(simpleSQL, simpleValues, (invoiceError, invoiceResult) => {
            if (invoiceError) {
                console.error('❌ Invoice insert error:', invoiceError);
                console.error('Full SQL error:', invoiceError);
                
                // Try even SIMPLER insert
                const minimalSQL = `
                    INSERT INTO purchase_invoices 
                    (vendor_id, invoice_no, invoice_date, transaction_date, 
                     currency_id, status, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                `;
                
                const minimalValues = [
                    invoiceData.vendor_id,
                    invoiceData.invoice_no,
                    invoiceData.invoice_date,
                    invoiceData.transaction_date,
                    invoiceData.currency_id,
                    'draft',
                    invoiceData.created_by
                ];
                
                db.query(minimalSQL, minimalValues, (minError, minResult) => {
                    if (minError) {
                        console.error('❌ Minimal insert also failed:', minError);
                        return res.status(500).json({
                            success: false,
                            error: 'Failed to save invoice: ' + minError.message
                        });
                    }
                    
                    console.log(`✅ Invoice saved with minimal fields! ID: ${minResult.insertId}`);
                    saveInvoiceItems(minResult.insertId, invoiceData, res);
                });
                
            } else {
                console.log(`✅ Invoice saved! ID: ${invoiceResult.insertId}`);
                saveInvoiceItems(invoiceResult.insertId, invoiceData, res);
            }
        });
        
    } catch (error) {
        console.error('❌ General error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Keep the saveInvoiceItems function same as before
// GET /api/purchase-invoices
app.get('/api/purchase-invoices', (req, res) => {
    try {
        let {
            page = 1,
            limit = 20,
            vendor_search = '',      // 🔥 FIX: Match frontend
            vendor_id = '',          // 🔥 FIX: Match frontend
            status = '',
            start_date = '',         // 🔥 FIX: Match frontend
            end_date = '',           // 🔥 FIX: Match frontend
            invoice_no = ''          // 🔥 FIX: Match frontend
        } = req.query;

        // Convert to numbers
        page = parseInt(page);
        limit = parseInt(limit);
        const offset = (page - 1) * limit;

        console.log('📋 API Request with filters:', {
            vendor_search, vendor_id, status, start_date, end_date, invoice_no, page, limit
        });

        // Base query
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
                pi.fc_amount,
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

        const params = [];
        const countParams = [];

        // 🔥 FIX 1: VENDOR SEARCH FILTER (Find a Vendor field)
        if (vendor_search && vendor_search.trim() !== '') {
            sql += ` AND (
                v.vendor_name LIKE ? OR 
                v.vendor_code LIKE ?
            )`;
            countSql += ` AND (
                v.vendor_name LIKE ? OR 
                v.vendor_code LIKE ?
            )`;
            const searchTerm = `%${vendor_search.trim()}%`;
            params.push(searchTerm, searchTerm);
            countParams.push(searchTerm, searchTerm);
            console.log(`🔍 Applying vendor search: ${searchTerm}`);
        }

        // 🔥 FIX 2: VENDOR DROPDOWN FILTER (Vendor select dropdown)
        if (vendor_id && vendor_id.trim() !== '' && vendor_id !== 'ALL') {
            sql += ` AND pi.vendor_id = ?`;
            countSql += ` AND pi.vendor_id = ?`;
            params.push(vendor_id);
            countParams.push(vendor_id);
            console.log(`🔍 Applying vendor filter: ${vendor_id}`);
        }

        // 🔥 FIX 3: STATUS FILTER (Complete logic)
       if (status && status.trim() !== '' && status !== 'ALL') {
    status = status.toLowerCase();
    console.log(`🔍 Applying PAYMENT status filter: ${status}`);
    
    if (status === 'overdue') {
        // Overdue = due_date < today AND payment_status = overdue
        sql += ` AND pi.payment_status = 'overdue'`;
        countSql += ` AND pi.payment_status = 'overdue'`;
    } 
    else if (status === 'new') {
        // New = payment_status = new
        sql += ` AND pi.payment_status = 'new'`;
        countSql += ` AND pi.payment_status = 'new'`;
    }
    else if (status === 'partial') {
        // Partial = payment_status = partial
        sql += ` AND pi.payment_status = 'partial'`;
        countSql += ` AND pi.payment_status = 'partial'`;
    }
    else if (status === 'paid') {
        // Paid = payment_status = paid
        sql += ` AND pi.payment_status = 'paid'`;
        countSql += ` AND pi.payment_status = 'paid'`;
    }
    else if (status === 'draft') {
        // Draft = invoice status = draft
        sql += ` AND pi.status = 'draft'`;
        countSql += ` AND pi.status = 'draft'`;
    }
    else if (status === 'cancelled') {
        // Cancelled = invoice status = cancelled
        sql += ` AND pi.status = 'cancelled'`;
        countSql += ` AND pi.status = 'cancelled'`;
    }
    else {
        // Default: direct payment_status match
        sql += ` AND pi.payment_status = ?`;
        countSql += ` AND pi.payment_status = ?`;
        params.push(status);
        countParams.push(status);
    }
}

        // 🔥 FIX 4: DATE FILTERS (Correct parameter names)
      if (start_date && start_date.trim() !== '' || end_date && end_date.trim() !== '') {
    console.log('📅 Processing date filters:', { start_date, end_date });
    
    if (start_date && start_date.trim() !== '' && end_date && end_date.trim() !== '') {
        // Case 1: Both dates provided = DATE RANGE
        sql += ` AND DATE(pi.transaction_date) BETWEEN ? AND ?`;
        countSql += ` AND DATE(pi.transaction_date) BETWEEN ? AND ?`;
        params.push(start_date, end_date);
        countParams.push(start_date, end_date);
        console.log(`🔍 Applying DATE RANGE: ${start_date} to ${end_date}`);
    }
    else if (start_date && start_date.trim() !== '') {
        // Case 2: Only Start Date = FROM this date onward
        sql += ` AND DATE(pi.transaction_date) >= ?`;
        countSql += ` AND DATE(pi.transaction_date) >= ?`;
        params.push(start_date);
        countParams.push(start_date);
        console.log(`🔍 Applying START DATE only: ${start_date} onward`);
    }
    else if (end_date && end_date.trim() !== '') {
        // Case 3: Only End Date = UP TO this date
        sql += ` AND DATE(pi.transaction_date) <= ?`;
        countSql += ` AND DATE(pi.transaction_date) <= ?`;
        params.push(end_date);
        countParams.push(end_date);
        console.log(`🔍 Applying END DATE only: up to ${end_date}`);
    }
}
        // 🔥 FIX 5: INVOICE NO FILTER (Correct parameter)
        if (invoice_no && invoice_no.trim() !== '') {
            sql += ` AND (
                pi.invoice_no LIKE ? OR
                pi.transaction_no LIKE ?
            )`;
            countSql += ` AND (
                pi.invoice_no LIKE ? OR
                pi.transaction_no LIKE ?
            )`;
            const invoiceSearch = `%${invoice_no.trim()}%`;
            params.push(invoiceSearch, invoiceSearch);
            countParams.push(invoiceSearch, invoiceSearch);
            console.log(`🔍 Invoice no search: ${invoiceSearch}`);
        }

        // Order and limit
        sql += ` ORDER BY pi.transaction_date DESC, pi.invoice_id DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        console.log('🔍 Final SQL Query:', sql);
        console.log('🔍 Query Parameters:', params);
        console.log('🔍 Count SQL:', countSql);
        console.log('🔍 Count Parameters:', countParams);

        // Execute queries
        db.query(countSql, countParams, (countErr, countResult) => {
            if (countErr) {
                console.error('❌ Count query error:', countErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + countErr.message
                });
            }

            const total = countResult[0]?.total || 0;
            
            if (total === 0) {
                console.log('ℹ️ No invoices found with current filters');
                return res.json({
                    success: true,
                    data: [],
                    summary: {
                        total_order: 0,
                        total_invoice: 0,
                        total_unpaid: 0,
                        total_paid: 0
                    },
                    pagination: {
                        page: page,
                        limit: limit,
                        total: 0,
                        total_pages: 0
                    }
                });
            }

            db.query(sql, params, (dataErr, dataResult) => {
                if (dataErr) {
                    console.error('❌ Data query error:', dataErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Database error: ' + dataErr.message
                    });
                }

                console.log(`✅ Found ${total} invoices, returning ${dataResult.length}`);

                // Get summary with same filters
                const summarySql = `
                    SELECT 
                        COALESCE(SUM(grand_total), 0) as total_invoice,
                        COALESCE(SUM(CASE WHEN payment_status = 'overdue' OR payment_status = 'new' THEN balance_amount ELSE 0 END), 0) as total_unpaid,
                        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN grand_total ELSE 0 END), 0) as total_paid,
                        COALESCE(SUM(fc_amount), 0) as total_order,
                        COUNT(*) as total_count
                    FROM purchase_invoices pi
                    WHERE 1=1
                    ${vendor_search ? `AND (SELECT vendor_name FROM vendors v WHERE v.vendor_id = pi.vendor_id AND (v.vendor_name LIKE '%${vendor_search}%' OR v.vendor_code LIKE '%${vendor_search}%'))` : ''}
                    ${vendor_id ? `AND pi.vendor_id = ${vendor_id}` : ''}
                    ${status ? `AND pi.status = '${status}'` : ''}
                    AND pi.status != 'cancelled'
                `;

                db.query(summarySql, (summaryErr, summaryResult) => {
                    if (summaryErr) {
                        console.error('❌ Summary error:', summaryErr);
                    }

                    const summary = summaryResult[0] || {};

                    res.json({
                        success: true,
                        data: dataResult,
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
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.get('/api/purchase-invoices/vendors-with-invoices', (req, res) => {
    const sql = `
        SELECT DISTINCT v.vendor_id, v.vendor_name, v.vendor_code
        FROM vendors v
        INNER JOIN purchase_invoices pi ON v.vendor_id = pi.vendor_id
        ORDER BY v.vendor_name
    `;
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Vendor check error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
        
        res.json({ success: true, data: results });
    });
});
app.get('/api/vendors/active', (req, res) => {
    try {
        console.log('👥 Getting active vendors');
        
        const sql = `
            SELECT vendor_id, vendor_code, vendor_name, email, phone 
            FROM vendors 
            WHERE is_active = 1 
            ORDER BY vendor_name
        `;
        
        db.query(sql, (err, result) => {
            if (err) {
                console.error('❌ Vendor error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }
            
            console.log(`✅ Found ${result.length} vendors`);
            
            res.json({
                success: true,
                data: result
            });
        });
        
    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// SIMPLIFIED VERSION - TEST FIRST:
app.get('/api/purchase-invoices/simple', (req, res) => {
    try {
        console.log('🧪 Simple test endpoint');
        
        const sql = `
            SELECT 
                pi.invoice_id,
                pi.invoice_no,
                pi.transaction_date,
                pi.due_date,
                pi.status,
                pi.payment_status,
                pi.grand_total,
                pi.balance_amount,
                v.vendor_name,
                c.currency_code
            FROM purchase_invoices pi
            LEFT JOIN vendors v ON pi.vendor_id = v.vendor_id
            LEFT JOIN currencies c ON pi.currency_id = c.currency_id
            ORDER BY pi.transaction_date DESC
            LIMIT 20
        `;
        
        db.query(sql, (err, result) => {
            if (err) {
                console.error('❌ Simple query error:', err);
                return res.status(500).json({
                    success: false,
                    error: err.message
                });
            }
            
            console.log(`✅ Simple: Found ${result.length} invoices`);
            
            res.json({
                success: true,
                data: result,
                summary: {
                    total_order: 0,
                    total_invoice: 0,
                    total_unpaid: 0,
                    total_paid: 0
                },
                pagination: {
                    page: 1,
                    limit: 20,
                    total: result.length,
                    total_pages: 1
                }
            });
        });
        
    } catch (error) {
        console.error('❌ Simple error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Add these to your app.js:

// GET: /api/purchase-invoices/:id - Get single invoice with items
app.get('/api/purchase-invoices/:id', (req, res) => {
    const invoiceId = req.params.id;
    
    // First, check and update status if needed
    const updateSql = `
        UPDATE purchase_invoices 
        SET payment_status = 'overdue'
        WHERE invoice_id = ?
        AND payment_status IN ('new', 'partial')
        AND due_date < CURDATE()
        AND status = 'posted'
    `;
    
    db.query(updateSql, [invoiceId], (updateErr) => {
        if (updateErr) {
            console.error('❌ Status update error:', updateErr);
        }
        
        // Then fetch the invoice
        const fetchSql = `
            SELECT 
                pi.*,
                v.vendor_name,
                v.vendor_code,
                c.currency_code
            FROM purchase_invoices pi
            LEFT JOIN vendors v ON pi.vendor_id = v.vendor_id
            LEFT JOIN currencies c ON pi.currency_id = c.currency_id
            WHERE pi.invoice_id = ?
        `;
        
        db.query(fetchSql, [invoiceId], (fetchErr, result) => {
            if (fetchErr) {
                return res.status(500).json({
                    success: false,
                    error: fetchErr.message
                });
            }
            
            if (result.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }
            
            const invoice = result[0];
            
            // Get items
            const itemsSql = `SELECT * FROM purchase_invoice_items WHERE invoice_id = ?`;
            db.query(itemsSql, [invoiceId], (itemsErr, items) => {
                if (itemsErr) {
                    console.error('❌ Items error:', itemsErr);
                }
                
                res.json({
                    success: true,
                    data: {
                        ...invoice,
                        items: items || []
                    }
                });
            });
        });
    });
});
// PUT: /api/purchase-invoices/:id - Update invoice
app.put('/api/purchase-invoices/:id', (req, res) => {
    const invoiceId = req.params.id;
    console.log(`📤 ULTIMATE UPDATE for invoice ${invoiceId}`);
    
    try {
        const updateData = req.body;
        console.log('📦 Update data received:', updateData);
        
        // 🔥 AUTO-CALCULATE PAYMENT STATUS
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
        
        // 🔥 CORRECTED SQL WITH ALL COMMAS
        const updateSQL = `
            UPDATE purchase_invoices SET
                vendor_id = ?,
                invoice_no = ?,
                transaction_no = ?,
                invoice_date = ?,
                transaction_date = ?,
                due_date = ?,
                expected_payment_date = ?,
                currency_id = ?,
                currency_rate = ?,
                gst_type = ?,
                gst_value = ?,
                terms = ?,
                po_no = ?,
                reference_no = ?,
                project_id = ?,
                add_to_project_costing = ?,
                discount_type = ?,
                discount_value = ?,
                discount_amount = ?,
                subtotal = ?,
                gst_amount = ?,
                fc_amount = ?,
                grand_total = ?,
                payment_status = ?,      -- 🔥 COMMA ADDED
                balance_amount = ?,      -- 🔥 THIS IS CORRECT
                remarks = ?,
                updated_at = NOW()
            WHERE invoice_id = ?
        `;
        
        const updateValues = [
            updateData.vendor_id || 0,
            updateData.invoice_no || '',
            updateData.transaction_no || '',
            updateData.invoice_date || new Date().toISOString().split('T')[0],
            updateData.transaction_date || new Date().toISOString().split('T')[0],
            updateData.due_date || null,
            updateData.expected_payment_date || null,
            updateData.currency_id || 1,
            updateData.currency_rate || 1.0000,
            updateData.gst_type || 'Exclusive',
            updateData.gst_value || 9.00,
            updateData.terms || '30 Days',
            updateData.po_no || '',
            updateData.reference_no || '',
            updateData.project_id || null,
            updateData.add_to_project_costing || 0,
            updateData.discount_type || '$',
            updateData.discount_value || 0,
            updateData.discount_amount || 0,
            updateData.subtotal || 0,
            updateData.gst_amount || 0,
            updateData.fc_amount || 0,
            updateData.grand_total || 0,
            paymentStatus,  // 🔥 ADDED HERE
            updateData.balance_amount || updateData.grand_total || 0,
            updateData.remarks || '',
            invoiceId
        ];
        
        console.log('🔢 SQL Values count:', updateValues.length);
        console.log('💾 Payment Status value:', paymentStatus);
        
        db.query(updateSQL, updateValues, (updateErr, updateResult) => {
            if (updateErr) {
                console.error('❌ Invoice update error:', updateErr);
                console.error('❌ Full SQL error:', updateErr.sqlMessage);
                console.error('❌ SQL that failed:', updateErr.sql);
                
                return res.status(500).json({
                    success: false,
                    error: 'Invoice update failed: ' + updateErr.message,
                    sqlError: updateErr.sqlMessage
                });
            }
            
            console.log(`✅ Invoice updated. Affected rows: ${updateResult.affectedRows}`);
            
            // 🔥 DELETE OLD ITEMS
            const deleteSQL = `DELETE FROM purchase_invoice_items WHERE invoice_id = ?`;
            
            db.query(deleteSQL, [invoiceId], (deleteErr, deleteResult) => {
                if (deleteErr) {
                    console.error('❌ Error deleting old items:', deleteErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to delete old items'
                    });
                }
                
                console.log(`🗑️ Deleted ${deleteResult.affectedRows} old items`);
                
                // 🔥 INSERT NEW ITEMS
                if (!updateData.items || updateData.items.length === 0) {
                    return res.json({
                        success: true,
                        message: 'Invoice updated successfully',
                        payment_status: paymentStatus,
                        data: { invoice_id: invoiceId }
                    });
                }
                
                const itemPromises = updateData.items.map(item => {
                    return new Promise((resolve, reject) => {
                        const itemSQL = `
                            INSERT INTO purchase_invoice_items 
                            (invoice_id, item_type, reference_item_id, item_code, 
                             item_name, quantity, unit_price, total_amount, uom)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `;
                        
                        const itemValues = [
                            invoiceId,
                            item.item_type || 'product',
                            item.reference_item_id || 0,
                            item.item_code || '',
                            item.item_name || 'Item',
                            item.quantity || 1,
                            item.unit_price || 0,
                            item.total_amount || 0,
                            item.uom || 'PCS'
                        ];
                        
                        db.query(itemSQL, itemValues, (itemErr, itemResult) => {
                            if (itemErr) reject(itemErr);
                            else resolve(itemResult);
                        });
                    });
                });
                
                Promise.all(itemPromises)
                    .then(() => {
                        console.log(`✅ All ${updateData.items.length} items saved`);
                        res.json({
                            success: true,
                            message: 'Invoice updated successfully',
                            payment_status: paymentStatus,
                            data: {
                                invoice_id: invoiceId,
                                items_updated: updateData.items.length
                            }
                        });
                    })
                    .catch(itemError => {
                        console.error('❌ Item save error:', itemError);
                        res.status(500).json({
                            success: false,
                            error: 'Failed to save items: ' + itemError.message
                        });
                    });
            });
        });
        
    } catch (error) {
        console.error('❌ Update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

function getPurchaseSummary(callback) {
    const summarySql = `
        SELECT 
            COUNT(*) as total_count,
            SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted_count,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_count,
            SUM(CASE WHEN payment_status = 'overdue' THEN 1 ELSE 0 END) as overdue_count,
            
            SUM(grand_total) as total_invoice,
            SUM(CASE WHEN status = 'posted' THEN grand_total ELSE 0 END) as total_posted,
            SUM(CASE WHEN status = 'paid' THEN grand_total ELSE 0 END) as total_paid,
            SUM(CASE WHEN payment_status = 'overdue' THEN balance_amount ELSE 0 END) as total_unpaid,
            SUM(fc_amount) as total_order
            
        FROM purchase_invoices
        WHERE status IN ('draft', 'posted', 'paid')
    `;

    db.query(summarySql, (err, result) => {
        if (err) {
            console.error('❌ Summary error:', err);
            return callback(err, null);
        }

        const summary = result[0] || {};
        
        callback(null, {
            total_order: summary.total_order || 0,
            total_invoice: summary.total_invoice || 0,
            total_unpaid: summary.total_unpaid || 0,
            total_paid: summary.total_paid || 0,
            counts: {
                total: summary.total_count || 0,
                posted: summary.posted_count || 0,
                paid: summary.paid_count || 0,
                draft: summary.draft_count || 0,
                overdue: summary.overdue_count || 0
            }
        });
    });
}

app.get('/api/purchase-invoices/summary', (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                total_order: 2,
                total_invoice: 4000.00,
                unpaid_invoice: 1500.00,
                paid_invoice: 0.00
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});


// Make sure your backend endpoint returns items:
app.get('/api/purchase-invoices/:id', (req, res) => {
    const invoiceId = req.params.id;
    
    // First, check and update status if needed
    const updateSql = `
        UPDATE purchase_invoices 
        SET payment_status = 'overdue'
        WHERE invoice_id = ?
        AND payment_status IN ('new', 'partial')
        AND due_date < CURDATE()
        AND status = 'posted'
    `;
    
    db.query(updateSql, [invoiceId], (updateErr) => {
        if (updateErr) {
            console.error('❌ Status update error:', updateErr);
        }
        
        // Then fetch the invoice
        const fetchSql = `
            SELECT 
                pi.*,
                v.vendor_name,
                v.vendor_code,
                c.currency_code
            FROM purchase_invoices pi
            LEFT JOIN vendors v ON pi.vendor_id = v.vendor_id
            LEFT JOIN currencies c ON pi.currency_id = c.currency_id
            WHERE pi.invoice_id = ?
        `;
        
        db.query(fetchSql, [invoiceId], (fetchErr, result) => {
            if (fetchErr) {
                return res.status(500).json({
                    success: false,
                    error: fetchErr.message
                });
            }
            
            if (result.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }
            
            const invoice = result[0];
            
            // Get items
            const itemsSql = `SELECT * FROM purchase_invoice_items WHERE invoice_id = ?`;
            db.query(itemsSql, [invoiceId], (itemsErr, items) => {
                if (itemsErr) {
                    console.error('❌ Items error:', itemsErr);
                }
                
                res.json({
                    success: true,
                    data: {
                        ...invoice,
                        items: items || []
                    }
                });
            });
        });
    });
});
app.post('/api/purchase-invoices/:id/post', (req, res) => {
    const invoiceId = req.params.id;
    
    // Get invoice details first
    const getSql = `SELECT due_date FROM purchase_invoices WHERE invoice_id = ?`;
    
    db.query(getSql, [invoiceId], (getErr, result) => {
        if (getErr) {
            return res.status(500).json({
                success: false,
                error: getErr.message
            });
        }
        
        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }
        
        const invoice = result[0];
        const today = new Date();
        const dueDate = new Date(invoice.due_date);
        
        // Determine payment status
        let paymentStatus = 'new';
        if (dueDate < today) {
            paymentStatus = 'overdue';
        }
        
        // Update invoice
        const updateSql = `
            UPDATE purchase_invoices 
            SET 
                status = 'posted',
                payment_status = ?,
                updated_at = NOW()
            WHERE invoice_id = ?
        `;
        
        db.query(updateSql, [paymentStatus, invoiceId], (updateErr, updateResult) => {
            if (updateErr) {
                return res.status(500).json({
                    success: false,
                    error: updateErr.message
                });
            }
            
            res.json({
                success: true,
                message: `Invoice posted successfully! Status: ${paymentStatus.toUpperCase()}`,
                data: {
                    status: 'posted',
                    payment_status: paymentStatus
                }
            });
        });
    });
});
// DELETE: /api/purchase-invoices/:id - Delete invoice
app.delete('/api/purchase-invoices/:id', (req, res) => {
    const invoiceId = req.params.id;
    console.log(`🗑️ Deleting purchase invoice: ${invoiceId}`);

    // Check if invoice exists
    const checkSql = 'SELECT invoice_no, status FROM purchase_invoices WHERE invoice_id = ?';

    db.query(checkSql, [invoiceId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }

        const invoiceNo = checkResult[0].invoice_no;
        const status = checkResult[0].status;
        
        // Check if invoice is posted or paid (can't delete)
        if (status === 'posted' || status === 'paid') {
            return res.status(400).json({
                success: false,
                error: `Cannot delete ${status} invoice. Cancel it first.`
            });
        }

        // Delete invoice (cascade will delete items)
        const deleteSql = 'DELETE FROM purchase_invoices WHERE invoice_id = ?';

        db.query(deleteSql, [invoiceId], (deleteErr, deleteResult) => {
            if (deleteErr) {
                console.error('❌ Delete error:', deleteErr);
                return res.status(500).json({
                    success: false,
                    error: 'Delete failed: ' + deleteErr.message
                });
            }

            console.log(`✅ Invoice "${invoiceNo}" deleted`);
            res.json({
                success: true,
                message: `Invoice "${invoiceNo}" deleted successfully`
            });
        });
    });
});
//=========================================Sales Invoices=============================================================================
// TEMPORARY FIX - Use your actual column names
app.get('/api/currencies/active', (req, res) => {
    try {
        console.log('🌐 Fetching active currencies');
        
        // 🔥 CHANGE COLUMN NAMES TO MATCH YOUR DATABASE
        const sql = `
            SELECT 
                currency_id, 
                code as currency_code,           -- if your column is 'code'
                name as currency_name,           -- if your column is 'name'
                symbol as currency_symbol,       -- if your column is 'symbol'
                exchange_rate,
                is_default,
                decimal_places,
                active as is_active              -- if your column is 'active'
            FROM currencies 
            WHERE active = 1                     -- if column is 'active'
            ORDER BY is_default DESC, code ASC
        `;

        db.query(sql, (err, results) => {
            if (err) {
                console.error('Database error:', err);
                console.error('SQL Error Code:', err.code);
                console.error('SQL Error Message:', err.sqlMessage);
                
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + err.message,
                    sqlError: err.sqlMessage
                });
            }

            console.log(`✅ Found ${results.length} active currencies`);
            
            res.json({
                success: true,
                data: results,
                count: results.length
            });
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});
app.get('/api/customers/table', (req, res) => {
    const {
        page = 1,
        limit = 20,
        search = '',
        status = 'all'
    } = req.query;

    const offset = (page - 1) * limit;
    
    // ✅ Include ALL address fields!
    let whereConditions = 'WHERE 1=1';
    const params = [];

    if (search && search.trim() !== '') {
        whereConditions += ` AND (
            c.customer_code LIKE ? OR 
            c.customer_name LIKE ? OR 
            c.contact_person1 LIKE ? OR 
            c.phone1 LIKE ? OR
            c.email LIKE ? OR
            c.salesman LIKE ?
        )`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Status filter
    if (status !== 'all') {
        if (status === 'active') {
            whereConditions += ' AND c.is_active = TRUE AND c.is_blocked = FALSE';
        } else if (status === 'inactive') {
            whereConditions += ' AND c.is_active = FALSE';
        } else if (status === 'blocked') {
            whereConditions += ' AND c.is_blocked = TRUE';
        }
    }

    // ✅ COMPLETE SELECT with ALL fields for auto-population
    const dataSql = `
        SELECT 
            c.customer_id,
            c.customer_code,
            c.customer_name,
            c.alias,
            c.company_reg_no,
            c.gst_reg,
            c.gst_type,
            
            -- 🔥 BILLING ADDRESS - ALL FIELDS
            c.address_line1,
            c.address_line2,
            c.address_line3,
            c.city,
            c.postal_code,
            c.country,
            
            -- 🔥 DELIVERY ADDRESS - ALL FIELDS
            c.is_delivery_same_address,
            c.delivery_address1,
            c.delivery_address2,
            c.delivery_address3,
            c.delivery_city,
            c.delivery_country,
            c.delivery_postal_code,
            
            -- 🔥 FINANCIAL
            c.currency,
            c.credit_limit,
            c.credit_terms,
            c.tolerance,
            
            -- 🔥 BANK
            c.bank_name,
            c.bank_account_no,
            
            -- 🔥 SALESMAN
            c.salesman,
            
            -- 🔥 CONTACT
            c.contact_person1,
            c.phone1,
            c.email,
            c.office_phone,
            
            -- Status
            c.is_active,
            c.is_blocked,
            c.created_at
            
        FROM customers c
        ${whereConditions}
        ORDER BY c.customer_code ASC
        LIMIT ? OFFSET ?
    `;

    const dataParams = [...params, parseInt(limit), parseInt(offset)];

    db.query(dataSql, dataParams, (err, results) => {
        if (err) {
            console.error('❌ Customer table error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }

        // Also get total count
        const countSql = `SELECT COUNT(*) as total FROM customers c ${whereConditions}`;
        
        db.query(countSql, params, (err, countResult) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }

            res.json({
                success: true,
                data: results,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult[0]?.total || 0,
                    totalPages: Math.ceil((countResult[0]?.total || 0) / limit)
                }
            });
        });
    });
});
// ============= SALES INVOICE ITEMS SAVE FUNCTION =============
function saveSalesInvoiceItems(invoiceId, invoiceData, res) {
    console.log(`💾 Saving ${invoiceData.items?.length || 0} items for sales invoice ${invoiceId}`);
    
    if (!invoiceData.items || invoiceData.items.length === 0) {
        return res.json({
            success: true,
            message: 'Invoice saved successfully (no items)',
            data: { 
                invoice_id: invoiceId, 
                invoice_no: invoiceData.invoice_no 
            }
        });
    }
    
    const itemPromises = invoiceData.items.map(item => {
        return new Promise((resolve, reject) => {
            
            // 🔥🔥🔥 FIX: Check if product exists before using ID
            if (item.type === 'product' && item.id) {
                // First verify product exists
                db.query('SELECT product_id FROM products WHERE product_id = ?', [item.id], (err, result) => {
                    if (err) {
                        console.error('❌ Product check error:', err);
                        // On error, use NULL to avoid constraint failure
                        insertItemWithNull(invoiceId, item, resolve, reject);
                    } else if (result.length === 0) {
                        // Product doesn't exist - use NULL for product_id
                        console.log(`⚠️ Product ID ${item.id} not found in products table, using NULL`);
                        insertItemWithNull(invoiceId, item, resolve, reject);
                    } else {
                        // Product exists - use the ID
                        insertItem(invoiceId, item, item.id, null, resolve, reject);
                    }
                });
            } else if (item.type === 'service' && item.id) {
                // Similar check for services
                db.query('SELECT service_id FROM services WHERE service_id = ?', [item.id], (err, result) => {
                    if (err || result.length === 0) {
                        console.log(`⚠️ Service ID ${item.id} not found, using NULL`);
                        insertItem(invoiceId, item, null, null, resolve, reject);
                    } else {
                        insertItem(invoiceId, item, null, item.id, resolve, reject);
                    }
                });
            } else {
                // No ID provided - insert with NULL foreign keys
                insertItem(invoiceId, item, null, null, resolve, reject);
            }
        });
    });
    
    Promise.all(itemPromises)
        .then(() => {
            console.log(`✅ All ${invoiceData.items.length} items saved for invoice ${invoiceId}`);
            res.json({
                success: true,
                message: 'Sales invoice created successfully',
                data: { 
                    invoice_id: invoiceId, 
                    invoice_no: invoiceData.invoice_no 
                }
            });
        })
        .catch(error => {
            console.error('❌ Failed to save items:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save invoice items: ' + error.message
            });
        });
}

// Helper function to insert with NULL product_id
function insertItemWithNull(invoiceId, item, resolve, reject) {
    insertItem(invoiceId, item, null, null, resolve, reject);
}

// Main insert function
function insertItem(invoiceId, item, product_id, service_id, resolve, reject) {
    
    // 🔥 UOM ID MAPPING
    let uom_id = 1; // Default PCS
    const uomMap = { 
        'PCS': 1, 'HOUR': 2, 'DAY': 3, 'MONTH': 4, 
        'BOX': 5, 'SET': 6, 'UNIT': 7, 'KG': 8, 'LTR': 9 
    };
    
    if (item.uom_id) {
        uom_id = item.uom_id;
    } else if (item.uom) {
        uom_id = uomMap[item.uom] || 1;
    }
    
    // Calculate GST amount per item
    const gst_amount_fc = (parseFloat(item.total) || 0) * (parseFloat(item.gst) || 9) / 100;
    
    const sql = `
        INSERT INTO invoice_items 
        (
            invoice_id, 
            product_id, 
            service_id, 
            item_type,
            item_code, 
            item_name, 
            uom_id,
            uom_code,
            quantity, 
            price_fc, 
            amount_fc,
            gst_rate,
            gst_amount_fc,
            line_no,
            created_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    
    const values = [
        invoiceId,
        product_id,  // Now this could be NULL if product doesn't exist
        service_id,
        item.type || 'product',
        item.code || '',
        item.name || 'Item',
        uom_id,
        item.uom || 'PCS',
        parseFloat(item.qty) || 1,
        parseFloat(item.price) || 0,
        parseFloat(item.total) || 0,
        parseFloat(item.gst) || 9,
        gst_amount_fc,
        item.line_no || 1
    ];
    
    console.log(`📝 Inserting item with product_id: ${product_id}`); // Debug log
    
    db.query(sql, values, (err, result) => {
        if (err) {
            console.error('❌ Item insert error:', err);
            reject(err);
        } else {
            console.log(`✅ Item saved: ${item.name} (${item.qty} x ${item.price})`);
            resolve(result);
        }
    });
}

// ============= SALES INVOICE CREATE =============
// POST /api/sales-invoices
app.post('/api/sales-invoices', (req, res) => {
    console.log('='.repeat(60));
    console.log('📥 SALES INVOICE SAVE REQUEST RECEIVED');
    console.log('='.repeat(60));
    
    try {
        // 🔥 AUTO-GENERATE INVOICE NUMBER if not provided
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
       const invoice_no = req.body.invoice_no;
        
        // VALIDATE - Invoice number must be from frontend!
        if (!invoice_no) {
            return res.status(400).json({
                success: false,
                error: 'Invoice number is required from frontend'
            });
        }
           const paidAmount = parseFloat(req.body.paid_amount) || 0;
        const grandTotal = parseFloat(req.body.grand_total_fc) || parseFloat(req.body.grand_total) || 0;
        const balanceAmount = parseFloat(req.body.balance_amount) || (grandTotal - paidAmount);
        
        // 🔥 DETERMINE PAYMENT STATUS
        let paymentStatus = 'new';
        if (req.body.due_date) {
            const dueDate = new Date(req.body.due_date);
            const today = new Date();
            
            if (paidAmount >= grandTotal && grandTotal > 0) {
                paymentStatus = 'paid';
            } else if (paidAmount > 0) {
                paymentStatus = 'partial';
            } else if (dueDate < today) {
                paymentStatus = 'overdue';
            }
        }

        // ============ EXTRACT ALL INVOICE DATA ============
        const invoiceData = {
            // ============ REQUIRED FIELDS ============
            customer_id: req.body.customer_id || null,
            invoice_no: invoice_no,  // 🔥🔥🔥 FRONTEND NUMBER!
            transaction_date: req.body.transaction_date || new Date().toISOString().split('T')[0],
            due_date: req.body.due_date || null,
            
            // ============ FOREIGN KEYS ============
            currency_id: req.body.currency_id || 1,
            bank_id: req.body.bank_id || null,
            salesman_id: req.body.salesman_id === 'custom' ? null : (req.body.salesman_id || null),
            project_id: req.body.project_id || null,
            
            // ============ DATES ============
            delivery_date: req.body.delivery_date || null,
            expected_collection_date: req.body.expected_collection_date || null,
            
            // ============ FINANCIAL ============
            subtotal_fc: parseFloat(req.body.subtotal_fc) || parseFloat(req.body.subtotal) || 0,
            discount_type: req.body.discount_type || '$',
            discount_value: parseFloat(req.body.discount_value) || 0,
            discount_amount_fc: parseFloat(req.body.discount_amount_fc) || parseFloat(req.body.discount_amount) || 0,
            gst_type: req.body.gst_type || 'Exclusive',
            gst_rate: parseFloat(req.body.gst_rate) || 9,
            gst_amount_fc: parseFloat(req.body.gst_amount_fc) || parseFloat(req.body.gst_amount) || 0,
            grand_total_fc: grandTotal,
            currency_rate: parseFloat(req.body.currency_rate) || 1,
            grand_total_sgd: parseFloat(req.body.grand_total_sgd) || (grandTotal * (parseFloat(req.body.currency_rate) || 1)),
            
            // ============ BILLING ADDRESS ============
            billing_address_line1: req.body.billing_address_line1 || '',
            billing_address_line2: req.body.billing_address_line2 || '',
            billing_postal_code: req.body.billing_postal_code || '',
            billing_country: req.body.billing_country || 'Singapore',
            
            // ============ DELIVERY ADDRESS ============
            delivery_address_line1: req.body.delivery_address_line1 || '',
            delivery_address_line2: req.body.delivery_address_line2 || '',
            delivery_postal_code: req.body.delivery_postal_code || '',
            delivery_country: req.body.delivery_country || 'Singapore',
            
            // ============ CONTACT ============
            attention: req.body.attention || '',
            email: req.body.email || '',
            contact_no: req.body.contact_no || '',
            
            // ============ REFERENCE NUMBERS ============
            order_no: req.body.order_no || '',
            po_no: req.body.po_no || '',
            quotation_no: req.body.quotation_no || '',
            claim_no: req.body.claim_no || '',
            service_no: req.body.service_no || '',
            
            // ============ PROJECT & TERMS ============
            project_title: req.body.project_title || '',
            inco_terms: req.body.inco_terms || '',
            profit_ref: req.body.profit_ref || '',
            remarks: req.body.remarks || '',
            terms_conditions: req.body.terms_conditions || '',
            
            // ============ STATUS & PAYMENT ============
            invoice_status: req.body.invoice_status || 'Draft',
            payment_status: paymentStatus,
            paid_amount: paidAmount,
            balance_amount: balanceAmount,
            
            // ============ AUDIT ============
            created_by: req.body.created_by || 1,
            
            // ============ ITEMS ============
            items: req.body.items || []
        };
        
        console.log('🔍 Invoice data prepared:', {
            customer_id: invoiceData.customer_id,
            invoice_no: invoiceData.invoice_no,  // 🔥 FRONTEND NUMBER!
            grand_total: invoiceData.grand_total_fc,
            items_count: invoiceData.items.length,
            payment_status: invoiceData.payment_status
        });
        console.log('💰 Currency Data for DB:', {
    currency_id: invoiceData.currency_id,
    currency_code: invoiceData.currency_code,
    exchange_rate: invoiceData.currency_rate,
    grand_total_fc: invoiceData.grand_total_fc,
    grand_total_sgd: invoiceData.grand_total_sgd
});
        // ============ VALIDATION ============
        if (!invoiceData.customer_id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Customer is required' 
            });
        }
        
        if (!invoiceData.items || invoiceData.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'At least one item is required' 
            });
        }
        
        // ============ SQL INSERT ============
        const sql = `
            INSERT INTO sales_invoices 
            (
                invoice_no, customer_id, currency_id, bank_id, salesman_id, project_id,
                transaction_date, due_date, delivery_date, expected_collection_date,
                subtotal_fc, discount_type, discount_value, discount_amount_fc,
                gst_type, gst_rate, gst_amount_fc, grand_total_fc, currency_rate, grand_total_sgd,
                billing_address_line1, billing_address_line2, billing_postal_code, billing_country,
                delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_country,
                attention, email, contact_no,
                order_no, po_no, quotation_no, claim_no, service_no,
                project_title, inco_terms, profit_ref, remarks, terms_conditions,
                invoice_status, payment_status, paid_amount, balance_amount,
                created_by, created_date
            ) VALUES (
                ?, ?, ?, ?, ?, ?,          -- 6: invoice_no to project_id
                ?, ?, ?, ?,                -- 4: transaction_date to expected_collection_date
                ?, ?, ?, ?,                -- 4: subtotal_fc to discount_amount_fc
                ?, ?, ?, ?, ?, ?,          -- 6: gst_type to grand_total_sgd
                ?, ?, ?, ?,                -- 4: billing_address_line1 to billing_country
                ?, ?, ?, ?,                -- 4: delivery_address_line1 to delivery_country
                ?, ?, ?,                   -- 3: attention to contact_no
                ?, ?, ?, ?, ?,             -- 5: order_no to service_no
                ?, ?, ?, ?, ?,             -- 5: project_title to terms_conditions
                ?, ?, ?, ?,                -- 4: invoice_status to balance_amount
                ?, NOW()                  -- 2: created_by and created_date
            )
        `;
        
        const values = [
            // Invoice & Foreign Keys (6)
            invoiceData.invoice_no,  // 🔥🔥🔥 FRONTEND INVOICE NUMBER!
            invoiceData.customer_id,
            invoiceData.currency_id,
            invoiceData.bank_id,
            invoiceData.salesman_id,
            invoiceData.project_id,
            
            // Dates (4)
            invoiceData.transaction_date,
            invoiceData.due_date,
            invoiceData.delivery_date,
            invoiceData.expected_collection_date,
            
            // Financial Part 1 (4)
            invoiceData.subtotal_fc,
            invoiceData.discount_type,
            invoiceData.discount_value,
            invoiceData.discount_amount_fc,
            
            // Financial Part 2 (6)
            invoiceData.gst_type,
            invoiceData.gst_rate,
            invoiceData.gst_amount_fc,
            invoiceData.grand_total_fc,
            invoiceData.currency_rate,
            invoiceData.grand_total_sgd,
            
            // Billing Address (4)
            invoiceData.billing_address_line1,
            invoiceData.billing_address_line2,
            invoiceData.billing_postal_code,
            invoiceData.billing_country,
            
            // Delivery Address (4)
            invoiceData.delivery_address_line1,
            invoiceData.delivery_address_line2,
            invoiceData.delivery_postal_code,
            invoiceData.delivery_country,
            
            // Contact (3)
            invoiceData.attention,
            invoiceData.email,
            invoiceData.contact_no,
            
            // Reference Numbers (5)
            invoiceData.order_no,
            invoiceData.po_no,
            invoiceData.quotation_no,
            invoiceData.claim_no,
            invoiceData.service_no,
            
            // Project & Terms (5)
            invoiceData.project_title,
            invoiceData.inco_terms,
            invoiceData.profit_ref,
            invoiceData.remarks,
            invoiceData.terms_conditions,
            
            // Status & Payment (4)
            invoiceData.invoice_status,
            invoiceData.payment_status,
            invoiceData.paid_amount,
            invoiceData.balance_amount,
            
            // Audit (1)
            invoiceData.created_by
        ];
        
        console.log(`🔢 SQL Values count: ${values.length}`);
        console.log(`📝 Inserting sales invoice with No: ${invoiceData.invoice_no}...`);
        
        // Execute
        db.query(sql, values, (invoiceError, invoiceResult) => {
            if (invoiceError) {
                console.error('❌ Sales invoice insert error:', invoiceError);
                
                // Check for duplicate entry
                if (invoiceError.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({
                        success: false,
                        error: `Invoice number ${invoiceData.invoice_no} already exists!`
                    });
                }
                
                // Try MINIMAL INSERT as fallback
                const minimalSQL = `
                    INSERT INTO sales_invoices 
                    (invoice_no, customer_id, currency_id, transaction_date, due_date, 
                     grand_total_fc, grand_total_sgd, invoice_status, created_by, created_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', ?, NOW())
                `;
                
                const minimalValues = [
                    invoiceData.invoice_no,  // 🔥 SAME FRONTEND NUMBER!
                    invoiceData.customer_id,
                    invoiceData.currency_id || 1,
                    invoiceData.transaction_date,
                    invoiceData.due_date || new Date().toISOString().split('T')[0],
                    invoiceData.grand_total_fc || 0,
                    invoiceData.grand_total_sgd || 0,
                    invoiceData.created_by || 1
                ];
                
                db.query(minimalSQL, minimalValues, (minError, minResult) => {
                    if (minError) {
                        console.error('❌ Minimal insert also failed:', minError);
                        return res.status(500).json({
                            success: false,
                            error: 'Failed to save invoice: ' + minError.message
                        });
                    }
                    
                    console.log(`✅ Sales invoice saved with MINIMAL fields! ID: ${minResult.insertId}, No: ${invoiceData.invoice_no}`);
                    saveSalesInvoiceItems(minResult.insertId, invoiceData, res);
                });
                
            } else {
                console.log(`✅ Sales invoice saved! ID: ${invoiceResult.insertId}, No: ${invoiceData.invoice_no}`);
                saveSalesInvoiceItems(invoiceResult.insertId, invoiceData, res);
            }
        });
        
    } catch (error) {
        console.error('❌ General error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============= GET SALES INVOICES WITH FILTERS =============
// GET /api/sales-invoices
app.get('/api/sales-invoices', (req, res) => {
    try {
        let {
            page = 1,
            limit = 20,
            salesman_id = '',
            currency_id = '',
            search = '',           // Customer/Project search
            invoice_no = '',
            start_date = '',
            end_date = '',
            payment_status = ''
        } = req.query;

        // Convert to numbers
        page = parseInt(page);
        limit = parseInt(limit);
        const offset = (page - 1) * limit;

        console.log('📋 Sales Invoice API with filters:', { 
            salesman_id, currency_id, search, invoice_no, 
            start_date, end_date, payment_status, page, limit 
        });

        // Build WHERE conditions dynamically
        let conditions = [];
        let params = [];

        // 1. SALESMAN FILTER
        if (salesman_id && salesman_id.trim() !== '' && salesman_id !== 'null' && salesman_id !== 'undefined') {
            conditions.push('si.salesman_id = ?');
            params.push(salesman_id);
        }

        // 2. CURRENCY FILTER
        if (currency_id && currency_id.trim() !== '' && currency_id !== 'null' && currency_id !== 'undefined') {
            conditions.push('si.currency_id = ?');
            params.push(currency_id);
        }

        // 3. CUSTOMER/PROJECT SEARCH (OR condition)
        if (search && search.trim() !== '') {
            const searchTerm = `%${search.trim()}%`;
            conditions.push('(c.customer_name LIKE ? OR c.customer_code LIKE ? OR si.project_title LIKE ?)');
            params.push(searchTerm, searchTerm, searchTerm);
        }

        // 4. INVOICE NO SEARCH
        if (invoice_no && invoice_no.trim() !== '') {
            conditions.push('si.invoice_no LIKE ?');
            params.push(`%${invoice_no.trim()}%`);
        }

        // 5. DATE RANGE
        if (start_date && start_date.trim() !== '') {
            conditions.push('DATE(si.transaction_date) >= ?');
            params.push(start_date);
        }
        
        if (end_date && end_date.trim() !== '') {
            conditions.push('DATE(si.transaction_date) <= ?');
            params.push(end_date);
        }

        // 6. PAYMENT STATUS
        if (payment_status && payment_status.trim() !== '' && payment_status !== 'null' && payment_status !== 'undefined') {
            conditions.push('si.payment_status = ?');
            params.push(payment_status);
        }

        // Build WHERE clause
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        
        // ========== COUNT QUERY ==========
        let countSql = `
            SELECT COUNT(*) as total 
            FROM sales_invoices si
            LEFT JOIN customers c ON si.customer_id = c.customer_id
            ${whereClause}
        `;
        
        // ========== DATA QUERY with ALL REQUIRED FIELDS ==========
        let dataSql = `
            SELECT 
                si.invoice_id,
                si.invoice_no,
                DATE_FORMAT(si.transaction_date, '%d/%m/%Y') as transaction_date,
                DATE_FORMAT(si.transaction_date, '%Y-%m-%d') as transaction_date_raw,
                si.due_date,
                si.project_title,
                si.payment_status,
                si.invoice_status,
                si.grand_total_fc,
                si.currency_rate,
                si.grand_total_sgd,
                si.balance_amount,
                si.paid_amount,
                
                c.customer_id,
                c.customer_code,
                c.customer_name,
                
                cur.currency_id,
                cur.currency_code,
                cur.currency_symbol,
                
                s.salesman_id,
                s.salesman_code,
                s.salesman_name
                
            FROM sales_invoices si
            LEFT JOIN customers c ON si.customer_id = c.customer_id
            LEFT JOIN currencies cur ON si.currency_id = cur.currency_id
            LEFT JOIN salesmen s ON si.salesman_id = s.salesman_id
            ${whereClause}
            ORDER BY si.transaction_date DESC, si.invoice_id DESC
            LIMIT ? OFFSET ?
        `;
        
        // Add pagination params
        const dataParams = [...params, limit, offset];
        
        console.log('🔍 Executing count query...');
        
        // Execute count query
        db.query(countSql, params, (countErr, countResult) => {
            if (countErr) {
                console.error('❌ Count query error:', countErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database error: ' + countErr.message
                });
            }

            const total = countResult[0]?.total || 0;
            
            // If no records, return empty array
            if (total === 0) {
                return res.json({
                    success: true,
                    data: [],
                    summary: {
                        total_invoice: 0,
                        total_paid: 0,
                        total_unpaid: 0,
                        total_overdue: 0
                    },
                    pagination: {
                        page: page,
                        limit: limit,
                        total: 0,
                        total_pages: 0
                    }
                });
            }

            console.log(`🔍 Executing data query, expecting ${total} records...`);
            
            db.query(dataSql, dataParams, (dataErr, dataResult) => {
                if (dataErr) {
                    console.error('❌ Data query error:', dataErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Database error: ' + dataErr.message
                    });
                }

                console.log(`✅ Found ${total} sales invoices, returning ${dataResult.length}`);

                // ========== GET SUMMARY STATS ==========
                const summarySql = `
                    SELECT 
                        COUNT(*) as total_count,
                        COALESCE(SUM(CASE WHEN payment_status != 'cancelled' THEN grand_total_sgd ELSE 0 END), 0) as total_invoice,
                        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN grand_total_sgd ELSE 0 END), 0) as total_paid,
                        COALESCE(SUM(CASE WHEN payment_status IN ('new', 'partial') THEN balance_amount * currency_rate ELSE 0 END), 0) as total_unpaid,
                        COALESCE(SUM(CASE WHEN payment_status = 'overdue' THEN balance_amount * currency_rate ELSE 0 END), 0) as total_overdue
                    FROM sales_invoices si
                    WHERE si.invoice_status != 'Cancelled'
                `;

                db.query(summarySql, (summaryErr, summaryResult) => {
                    if (summaryErr) {
                        console.error('❌ Summary error:', summaryErr);
                    }

                    const summary = summaryResult?.[0] || {};

                    res.json({
                        success: true,
                        data: dataResult.map(invoice => ({
                            ...invoice,
                            // Format currency display
                            grand_total_fc_formatted: this.formatCurrency(invoice.grand_total_fc, invoice.currency_code),
                            grand_total_sgd_formatted: `SGD ${parseFloat(invoice.grand_total_sgd || 0).toFixed(2)}`,
                            balance_formatted: this.formatCurrency(invoice.balance_amount, invoice.currency_code),
                            // Status badge color
                            status_badge: this.getStatusBadge(invoice.payment_status)
                        })),
                        summary: {
                            total_invoice: summary.total_invoice || 0,
                            total_paid: summary.total_paid || 0,
                            total_unpaid: summary.total_unpaid || 0,
                            total_overdue: summary.total_overdue || 0,
                            total_invoice_formatted: `SGD ${parseFloat(summary.total_invoice || 0).toFixed(2)}`,
                            total_paid_formatted: `SGD ${parseFloat(summary.total_paid || 0).toFixed(2)}`,
                            total_unpaid_formatted: `SGD ${parseFloat(summary.total_unpaid || 0).toFixed(2)}`,
                            total_overdue_formatted: `SGD ${parseFloat(summary.total_overdue || 0).toFixed(2)}`
                        },
                        pagination: {
                            page: page,
                            limit: limit,
                            total: total,
                            total_pages: Math.ceil(total / limit)
                        }
                    });
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function for status badge
function getStatusBadge(status) {
    const badges = {
        'new': { color: '#3b82f6', bg: '#eff6ff', text: 'New' },
        'partial': { color: '#f59e0b', bg: '#fffbeb', text: 'Partial' },
        'paid': { color: '#10b981', bg: '#f0fdf4', text: 'Paid' },
        'overdue': { color: '#ef4444', bg: '#fef2f2', text: 'Overdue' },
        'draft': { color: '#64748b', bg: '#f1f5f9', text: 'Draft' }
    };
    return badges[status] || { color: '#64748b', bg: '#f1f5f9', text: status };
}

// Helper function for currency format
function formatCurrency(amount, currency) {
    const symbols = { 'SGD': 'S$', 'USD': 'US$', 'EUR': '€', 'GBP': '£', 'JPY': '¥' };
    const symbol = symbols[currency] || currency;
    return `${symbol} ${parseFloat(amount || 0).toFixed(2)}`;
}
app.get('/api/sales-invoices/list', (req, res) => {
    try {
        // ===== 1. EXTRACT ALL FILTER PARAMETERS =====
        const {
            page = 1,
            limit = 20,
            
            // 🔥 NEW FILTERS
            salesman_id = '',
            currency_id = '',
            customer_project = '',
            invoice_no = '',
            start_date = '',
            end_date = '',
            payment_status = '',
            
            // Sort
            sort_by = 'transaction_date',
            sort_order = 'DESC'
        } = req.query;

        // Convert to numbers
        const currentPage = parseInt(page);
        const pageLimit = parseInt(limit);
        const offset = (currentPage - 1) * pageLimit;

        console.log('📋 Invoice Listing Request:', {
            page: currentPage,
            limit: pageLimit,
            salesman_id,
            currency_id,
            customer_project,
            invoice_no,
            start_date,
            end_date,
            payment_status
        });

        // ===== 2. BUILD DYNAMIC WHERE CLAUSE =====
        let whereConditions = [];
        let queryParams = [];

        // 👤 SALESMAN FILTER
        if (salesman_id && salesman_id !== '') {
            whereConditions.push('si.salesman_id = ?');
            queryParams.push(salesman_id);
        }

        // 💰 CURRENCY FILTER
        if (currency_id && currency_id !== '') {
            whereConditions.push('si.currency_id = ?');
            queryParams.push(currency_id);
        }

        // 🔍 CUSTOMER/PROJECT SEARCH
        if (customer_project && customer_project.trim() !== '') {
            whereConditions.push(`(
                c.customer_name LIKE ? OR 
                c.customer_code LIKE ? OR 
                si.project_title LIKE ?
            )`);
            const searchTerm = `%${customer_project.trim()}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm);
        }

        // 🔢 INVOICE NO SEARCH
        if (invoice_no && invoice_no.trim() !== '') {
            whereConditions.push('si.invoice_no LIKE ?');
            queryParams.push(`%${invoice_no.trim()}%`);
        }

        // 📅 DATE RANGE FILTER
        if (start_date && start_date.trim() !== '') {
            whereConditions.push('DATE(si.transaction_date) >= ?');
            queryParams.push(start_date);
        }
        
        if (end_date && end_date.trim() !== '') {
            whereConditions.push('DATE(si.transaction_date) <= ?');
            queryParams.push(end_date);
        }

        // 💳 PAYMENT STATUS FILTER
        if (payment_status && payment_status.trim() !== '') {
            whereConditions.push('si.payment_status = ?');
            queryParams.push(payment_status);
        }

        // Build WHERE clause
        const whereClause = whereConditions.length > 0 
            ? 'WHERE ' + whereConditions.join(' AND ')
            : 'WHERE 1=1';

        // ===== 3. COUNT TOTAL RECORDS =====
        const countSQL = `
            SELECT COUNT(*) as total
            FROM sales_invoices si
            LEFT JOIN customers c ON si.customer_id = c.customer_id
            ${whereClause}
        `;

        db.query(countSQL, queryParams, (countErr, countResult) => {
            if (countErr) {
                console.error('❌ Count error:', countErr);
                return res.status(500).json({
                    success: false,
                    error: 'Database count error: ' + countErr.message
                });
            }

            const totalRecords = countResult[0]?.total || 0;
            const totalPages = Math.ceil(totalRecords / pageLimit);

            // ===== 4. FETCH INVOICE DATA =====
            const dataSQL = `
                SELECT 
                    -- Invoice Basic
                    si.invoice_id,
                    si.invoice_no,
                    DATE_FORMAT(si.transaction_date, '%d-%m-%Y') as transaction_date,
                    DATE_FORMAT(si.due_date, '%d-%m-%Y') as due_date,
                    
                    -- Customer Info
                    si.customer_id,
                    c.customer_code,
                    c.customer_name,
                    
                    -- Project
                    si.project_title,
                    
                    -- Financial
                    si.subtotal_fc,
                    si.discount_amount_fc,
                    si.gst_amount_fc,
                    si.grand_total_fc,
                    si.grand_total_sgd,
                    si.balance_amount,
                    
                    -- Payment Status
                    si.payment_status,
                    si.paid_amount,
                    
                    -- Currency
                    si.currency_id,
                    cur.currency_code,
                    cur.currency_name,
                    
                    -- Salesman
                    si.salesman_id,
                    sm.salesman_code,
                    sm.salesman_name,
                    
                    -- Invoice Status
                    si.invoice_status,
                    si.created_date
                    
                FROM sales_invoices si
                LEFT JOIN customers c ON si.customer_id = c.customer_id
                LEFT JOIN currencies cur ON si.currency_id = cur.currency_id
                LEFT JOIN salesmen sm ON si.salesman_id = sm.salesman_id
                ${whereClause}
                ORDER BY ${sort_by} ${sort_order}
                LIMIT ? OFFSET ?
            `;

            // Add pagination params
            const dataParams = [...queryParams, pageLimit, offset];

            db.query(dataSQL, dataParams, (dataErr, dataResult) => {
                if (dataErr) {
                    console.error('❌ Data fetch error:', dataErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Database fetch error: ' + dataErr.message
                    });
                }

                console.log(`✅ Found ${totalRecords} invoices, returning ${dataResult.length}`);

                // ===== 5. FETCH SUMMARY STATS =====
                const summarySQL = `
                    SELECT 
                        COALESCE(SUM(CASE WHEN si.invoice_status != 'Cancelled' THEN si.grand_total_fc ELSE 0 END), 0) as total_order,
                        COALESCE(COUNT(si.invoice_id), 0) as total_invoice_count,
                        COALESCE(SUM(si.grand_total_fc), 0) as total_invoice,
                        COALESCE(SUM(CASE WHEN si.payment_status IN ('new', 'partial', 'overdue') THEN si.balance_amount ELSE 0 END), 0) as total_unpaid,
                        COALESCE(SUM(CASE WHEN si.payment_status = 'paid' THEN si.grand_total_fc ELSE 0 END), 0) as total_paid
                    FROM sales_invoices si
                    WHERE si.invoice_status != 'Cancelled'
                `;

                db.query(summarySQL, [], (summaryErr, summaryResult) => {
                    if (summaryErr) {
                        console.error('❌ Summary error:', summaryErr);
                    }

                    const summary = summaryResult?.[0] || {};

                    // ===== 6. SEND RESPONSE =====
                    res.json({
                        success: true,
                        data: dataResult,
                        summary: {
                            total_order: summary.total_order || 0,
                            total_invoice: summary.total_invoice || 0,
                            total_unpaid: summary.total_unpaid || 0,
                            total_paid: summary.total_paid || 0,
                            total_invoice_count: summary.total_invoice_count || 0
                        },
                        pagination: {
                            page: currentPage,
                            limit: pageLimit,
                            total: totalRecords,
                            total_pages: totalPages
                        }
                    });
                });
            });
        });

    } catch (error) {
        console.error('❌ Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.get('/api/sales-invoices/filter-data', (req, res) => {
    console.log('📊 Fetching filter dropdown data...');
    
    // Fetch all in parallel
    Promise.all([
        // 1. Salesmen for filter
        new Promise((resolve) => {
            db.query(
                'SELECT salesman_id, salesman_code, salesman_name FROM salesmen WHERE status = "Active" ORDER BY salesman_name',
                (err, results) => {
                    if (err) {
                        console.error('❌ Salesman filter error:', err);
                        resolve([]);
                    } else {
                        resolve(results || []);
                    }
                }
            );
        }),
        
        // 2. Currencies for filter
        new Promise((resolve) => {
            db.query(
                'SELECT currency_id, currency_code, currency_name FROM currencies ORDER BY currency_code',
                (err, results) => {
                    if (err) {
                        console.error('❌ Currency filter error:', err);
                        resolve([]);
                    } else {
                        resolve(results || []);
                    }
                }
            );
        })
        
    ]).then(([salesmen, currencies]) => {
        res.json({
            success: true,
            data: {
                salesmen: salesmen,
                currencies: currencies
            }
        });
    }).catch(error => {
        console.error('❌ Filter data error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    });
});

// ============================================
// 🔥 GET SINGLE INVOICE DETAILS (FOR EDIT/VIEW)
// ============================================
// GET /api/sales-invoices/:id/details
app.get('/api/sales-invoices/:id/details', (req, res) => {
    const invoiceId = req.params.id;
    
    console.log(`🔍 Fetching invoice ${invoiceId} details...`);
    
    // Update overdue status first
    const updateSQL = `
        UPDATE sales_invoices 
        SET payment_status = 'overdue'
        WHERE invoice_id = ?
        AND payment_status IN ('new', 'partial')
        AND due_date < CURDATE()
        AND invoice_status = 'Confirmed'
    `;
    
    db.query(updateSQL, [invoiceId], () => {
        // Fetch invoice with all details
        const fetchSQL = `
            SELECT 
                si.*,
                c.customer_code,
                c.customer_name,
                c.gst_reg,
                c.currency as customer_currency,
                cur.currency_code,
                cur.currency_name,
                b.bank_name,
                b.account_number as bank_account_no,
                sm.salesman_code,
                sm.salesman_name,
                p.project_code,
                p.project_name
            FROM sales_invoices si
            LEFT JOIN customers c ON si.customer_id = c.customer_id
            LEFT JOIN currencies cur ON si.currency_id = cur.currency_id
            LEFT JOIN banks b ON si.bank_id = b.bank_id
            LEFT JOIN salesmen sm ON si.salesman_id = sm.salesman_id
            LEFT JOIN projects p ON si.project_id = p.project_id
            WHERE si.invoice_id = ?
        `;
        
        db.query(fetchSQL, [invoiceId], (fetchErr, invoiceResult) => {
            if (fetchErr) {
                return res.status(500).json({
                    success: false,
                    error: fetchErr.message
                });
            }
            
            if (invoiceResult.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Invoice not found'
                });
            }
            
            const invoice = invoiceResult[0];
            
            // Fetch items
            const itemsSQL = `
                SELECT 
                    ii.*,
                    p.product_code,
                    p.product_name,
                    s.service_code,
                    s.service_name,
                    u.uom_code,
                    u.uom_name
                FROM invoice_items ii
                LEFT JOIN products p ON ii.product_id = p.product_id
                LEFT JOIN services s ON ii.service_id = s.service_id
                LEFT JOIN uoms u ON ii.uom_id = u.uom_id
                WHERE ii.invoice_id = ?
                ORDER BY ii.line_no
            `;
            
            db.query(itemsSQL, [invoiceId], (itemsErr, items) => {
                if (itemsErr) {
                    console.error('❌ Items fetch error:', itemsErr);
                }
                
                res.json({
                    success: true,
                    data: {
                        ...invoice,
                        items: items || []
                    }
                });
            });
        });
    });
});

// ============================================
// 🔥 DELETE DRAFT INVOICE
// ============================================
// DELETE /api/sales-invoices/:id
app.delete('/api/sales-invoices/:id', (req, res) => {
    const invoiceId = req.params.id;
    
    console.log(`🗑️ Deleting invoice ${invoiceId}...`);
    
    // Check if invoice is Draft
    const checkSQL = 'SELECT invoice_no, invoice_status FROM sales_invoices WHERE invoice_id = ?';
    
    db.query(checkSQL, [invoiceId], (checkErr, result) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: checkErr.message
            });
        }
        
        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }
        
        const invoice = result[0];
        
        // Only allow deletion of Draft invoices
        if (invoice.invoice_status !== 'Draft') {
            return res.status(400).json({
                success: false,
                error: `Cannot delete ${invoice.invoice_status} invoice. Cancel it first.`
            });
        }
        
        // Delete (cascade will delete items)
        const deleteSQL = 'DELETE FROM sales_invoices WHERE invoice_id = ?';
        
        db.query(deleteSQL, [invoiceId], (deleteErr) => {
            if (deleteErr) {
                console.error('❌ Delete error:', deleteErr);
                return res.status(500).json({
                    success: false,
                    error: deleteErr.message
                });
            }
            
            console.log(`✅ Invoice ${invoice.invoice_no} deleted successfully`);
            
            res.json({
                success: true,
                message: `Invoice ${invoice.invoice_no} deleted successfully`
            });
        });
    });
});

// ============================================
// 🔥 UPDATE PAYMENT STATUS (Quick Action)
// ============================================
// PATCH /api/sales-invoices/:id/payment-status
app.patch('/api/sales-invoices/:id/payment-status', (req, res) => {
    const invoiceId = req.params.id;
    const { payment_status, paid_amount } = req.body;
    
    console.log(`💰 Updating payment status for invoice ${invoiceId}: ${payment_status}`);
    
    // First get current invoice
    const getSQL = 'SELECT grand_total_fc, paid_amount FROM sales_invoices WHERE invoice_id = ?';
    
    db.query(getSQL, [invoiceId], (getErr, result) => {
        if (getErr || result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }
        
        const invoice = result[0];
        const newPaidAmount = paid_amount !== undefined ? parseFloat(paid_amount) : invoice.paid_amount;
        const balanceAmount = invoice.grand_total_fc - newPaidAmount;
        
        // Determine payment status
        let finalPaymentStatus = payment_status;
        if (newPaidAmount >= invoice.grand_total_fc) {
            finalPaymentStatus = 'paid';
        } else if (newPaidAmount > 0) {
            finalPaymentStatus = 'partial';
        }
        
        const updateSQL = `
            UPDATE sales_invoices 
            SET payment_status = ?,
                paid_amount = ?,
                balance_amount = ?,
                modified_date = NOW()
            WHERE invoice_id = ?
        `;
        
        db.query(updateSQL, [finalPaymentStatus, newPaidAmount, balanceAmount, invoiceId], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({
                    success: false,
                    error: updateErr.message
                });
            }
            
            res.json({
                success: true,
                message: 'Payment status updated successfully',
                data: {
                    payment_status: finalPaymentStatus,
                    paid_amount: newPaidAmount,
                    balance_amount: balanceAmount
                }
            });
        });
    });
});

app.get('/api/customers/with-projects', (req, res) => {
    const sql = `
        SELECT 
            c.customer_id,
            c.customer_code,
            c.customer_name,
            p.project_id,
            p.project_code,
            p.project_name
        FROM customers c
        LEFT JOIN projects p ON c.customer_id = p.customer_id
        WHERE c.status = 'Active'
        ORDER BY c.customer_name, p.project_name
    `;
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Error fetching customers with projects:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
        
        res.json({
            success: true,
            data: results
        });
    });
});

// ============= GET SINGLE SALES INVOICE WITH ITEMS =============
// GET /api/sales-invoices/:id
app.get('/api/sales-invoices/:id', (req, res) => {
    const invoiceId = req.params.id;
    console.log(`🔍 Fetching sales invoice ${invoiceId} with items`);

    // Update payment status based on due date
    const updateSql = `
        UPDATE sales_invoices 
        SET payment_status = 'overdue'
        WHERE invoice_id = ?
        AND payment_status IN ('new', 'partial')
        AND due_date < CURDATE()
        AND invoice_status = 'Confirmed'
    `;
    
    db.query(updateSql, [invoiceId], (updateErr) => {
        if (updateErr) {
            console.error('❌ Status update error:', updateErr);
        }
        
        // Fetch invoice header
        const fetchSql = `
            SELECT 
                si.*,
                c.customer_code,
                c.customer_name,
                c.gst_reg,
                cur.currency_code,
                cur.currency_name,
                b.bank_name,
                b.account_number as bank_account_no,
                sm.salesman_code,
                sm.salesman_name,
                p.project_code,
                p.project_name
            FROM sales_invoices si
            LEFT JOIN customers c ON si.customer_id = c.customer_id
            LEFT JOIN currencies cur ON si.currency_id = cur.currency_id
            LEFT JOIN banks b ON si.bank_id = b.bank_id
            LEFT JOIN salesmen sm ON si.salesman_id = sm.salesman_id
            LEFT JOIN projects p ON si.project_id = p.project_id
            WHERE si.invoice_id = ?
        `;
        
        db.query(fetchSql, [invoiceId], (fetchErr, result) => {
            if (fetchErr) {
                console.error('❌ Fetch error:', fetchErr);
                return res.status(500).json({
                    success: false,
                    error: fetchErr.message
                });
            }
            
            if (result.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Sales invoice not found'
                });
            }
            
            const invoice = result[0];
            
            // Fetch invoice items
            const itemsSql = `
                SELECT 
                    ii.*,
                    p.product_code,
                    p.product_name,
                    s.service_code,
                    s.service_name,
                    u.uom_code,
                    u.uom_name
                FROM invoice_items ii
                LEFT JOIN products p ON ii.product_id = p.product_id
                LEFT JOIN services s ON ii.service_id = s.service_id
                LEFT JOIN uoms u ON ii.uom_id = u.uom_id
                WHERE ii.invoice_id = ?
                ORDER BY ii.line_no
            `;
            
            db.query(itemsSql, [invoiceId], (itemsErr, items) => {
                if (itemsErr) {
                    console.error('❌ Items fetch error:', itemsErr);
                }
                
                console.log(`✅ Found invoice ${invoiceId} with ${items?.length || 0} items`);
                
                res.json({
                    success: true,
                    data: {
                        ...invoice,
                        items: items || []
                    }
                });
            });
        });
    });
});

// ============= UPDATE SALES INVOICE =============
// PUT /api/sales-invoices/:id
app.put('/api/sales-invoices/:id', (req, res) => {
    const invoiceId = req.params.id;
    console.log(`📤 UPDATING sales invoice ${invoiceId}`);
    
    try {
        const updateData = req.body;
        
        // 🔥 AUTO-CALCULATE PAYMENT STATUS
        let paymentStatus = updateData.payment_status || 'new';
        
        if (updateData.due_date) {
            const today = new Date();
            const dueDate = new Date(updateData.due_date);
            const paidAmount = parseFloat(updateData.paid_amount) || 0;
            const grandTotal = parseFloat(updateData.grand_total_fc) || 0;
            
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
        
        // Update SQL
        const updateSQL = `
            UPDATE sales_invoices SET
                customer_id = ?,
                invoice_no = ?,
                currency_id = ?,
                bank_id = ?,
                salesman_id = ?,
                project_id = ?,
                transaction_date = ?,
                due_date = ?,
                delivery_date = ?,
                expected_collection_date = ?,
                subtotal_fc = ?,
                discount_type = ?,
                discount_value = ?,
                discount_amount_fc = ?,
                gst_type = ?,
                gst_rate = ?,
                gst_amount_fc = ?,
                grand_total_fc = ?,
                currency_rate = ?,
                grand_total_sgd = ?,
                billing_address_line1 = ?,
                billing_address_line2 = ?,
                billing_postal_code = ?,
                billing_country = ?,
                delivery_address_line1 = ?,
                delivery_address_line2 = ?,
                delivery_postal_code = ?,
                delivery_country = ?,
                attention = ?,
                email = ?,
                contact_no = ?,
                order_no = ?,
                po_no = ?,
                quotation_no = ?,
                claim_no = ?,
                service_no = ?,
                project_title = ?,
                inco_terms = ?,
                profit_ref = ?,
                remarks = ?,
                terms_conditions = ?,
                invoice_status = ?,
                payment_status = ?,
                paid_amount = ?,
                balance_amount = ?,
                modified_by = ?,
                modified_date = NOW()
            WHERE invoice_id = ?
        `;
        
        const updateValues = [
            updateData.customer_id || null,
            updateData.invoice_no || '',
            updateData.currency_id || 1,
            updateData.bank_id || null,
            updateData.salesman_id || null,
            updateData.project_id || null,
            updateData.transaction_date || new Date().toISOString().split('T')[0],
            updateData.due_date || null,
            updateData.delivery_date || null,
            updateData.expected_collection_date || null,
            parseFloat(updateData.subtotal_fc) || 0,
            updateData.discount_type || '$',
            parseFloat(updateData.discount_value) || 0,
            parseFloat(updateData.discount_amount_fc) || 0,
            updateData.gst_type || 'Exclusive',
            parseFloat(updateData.gst_rate) || 9,
            parseFloat(updateData.gst_amount_fc) || 0,
            parseFloat(updateData.grand_total_fc) || 0,
            parseFloat(updateData.currency_rate) || 1,
            parseFloat(updateData.grand_total_sgd) || 0,
            updateData.billing_address_line1 || '',
            updateData.billing_address_line2 || '',
            updateData.billing_postal_code || '',
            updateData.billing_country || 'Singapore',
            updateData.delivery_address_line1 || '',
            updateData.delivery_address_line2 || '',
            updateData.delivery_postal_code || '',
            updateData.delivery_country || 'Singapore',
            updateData.attention || '',
            updateData.email || '',
            updateData.contact_no || '',
            updateData.order_no || '',
            updateData.po_no || '',
            updateData.quotation_no || '',
            updateData.claim_no || '',
            updateData.service_no || '',
            updateData.project_title || '',
            updateData.inco_terms || '',
            updateData.profit_ref || '',
            updateData.remarks || '',
            updateData.terms_conditions || '',
            updateData.invoice_status || 'Draft',
            paymentStatus,
            parseFloat(updateData.paid_amount) || 0,
            parseFloat(updateData.balance_amount) || (parseFloat(updateData.grand_total_fc) || 0),
            updateData.modified_by || 1,
            invoiceId
        ];
        
        db.query(updateSQL, updateValues, (updateErr, updateResult) => {
            if (updateErr) {
                console.error('❌ Update error:', updateErr);
                return res.status(500).json({
                    success: false,
                    error: 'Update failed: ' + updateErr.message
                });
            }
            
            console.log(`✅ Invoice updated. Affected rows: ${updateResult.affectedRows}`);
            
            // Delete old items
            const deleteSQL = `DELETE FROM invoice_items WHERE invoice_id = ?`;
            
            db.query(deleteSQL, [invoiceId], (deleteErr) => {
                if (deleteErr) {
                    console.error('❌ Delete items error:', deleteErr);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to delete old items'
                    });
                }
                
                // Insert new items
                if (!updateData.items || updateData.items.length === 0) {
                    return res.json({
                        success: true,
                        message: 'Invoice updated successfully',
                        payment_status: paymentStatus
                    });
                }
                
                const itemPromises = updateData.items.map((item, index) => {
                    return new Promise((resolve, reject) => {
                        
                        let product_id = null;
                        let service_id = null;
                        
                        if (item.type === 'product') {
                            product_id = item.id || null;
                        } else if (item.type === 'service') {
                            service_id = item.id || null;
                        }
                        
                        // UOM ID mapping
                        let uom_id = 1;
                        const uomMap = { 'PCS': 1, 'HOUR': 2, 'DAY': 3, 'MONTH': 4, 'BOX': 5, 'SET': 6 };
                        if (item.uom_id) {
                            uom_id = item.uom_id;
                        } else if (item.uom) {
                            uom_id = uomMap[item.uom] || 1;
                        }
                        
                        const gst_amount = (parseFloat(item.total) || 0) * (parseFloat(item.gst) || 9) / 100;
                        
                        const itemSQL = `
                            INSERT INTO invoice_items 
                            (invoice_id, product_id, service_id, item_type,
                             item_code, item_name, uom_id, uom_code,
                             quantity, price_fc, amount_fc, gst_rate, gst_amount_fc,
                             line_no, created_date)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                        `;
                        
                        const itemValues = [
                            invoiceId,
                            product_id,
                            service_id,
                            item.type || 'product',
                            item.code || '',
                            item.name || 'Item',
                            uom_id,
                            item.uom || 'PCS',
                            parseFloat(item.qty) || 1,
                            parseFloat(item.price) || 0,
                            parseFloat(item.total) || 0,
                            parseFloat(item.gst) || 9,
                            gst_amount,
                            index + 1
                        ];
                        
                        db.query(itemSQL, itemValues, (itemErr, itemResult) => {
                            if (itemErr) reject(itemErr);
                            else resolve(itemResult);
                        });
                    });
                });
                
                Promise.all(itemPromises)
                    .then(() => {
                        console.log(`✅ All ${updateData.items.length} items updated`);
                        res.json({
                            success: true,
                            message: 'Invoice updated successfully',
                            payment_status: paymentStatus,
                            data: {
                                invoice_id: invoiceId,
                                items_updated: updateData.items.length
                            }
                        });
                    })
                    .catch(itemError => {
                        console.error('❌ Item save error:', itemError);
                        res.status(500).json({
                            success: false,
                            error: 'Failed to save items: ' + itemError.message
                        });
                    });
            });
        });
        
    } catch (error) {
        console.error('❌ Update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= CONFIRM SALES INVOICE =============
// POST /api/sales-invoices/:id/confirm
app.post('/api/sales-invoices/:id/confirm', (req, res) => {
    const invoiceId = req.params.id;
    console.log(`✅ Confirming sales invoice ${invoiceId}`);
    
    // Get invoice due date
    const getSql = `SELECT due_date FROM sales_invoices WHERE invoice_id = ?`;
    
    db.query(getSql, [invoiceId], (getErr, result) => {
        if (getErr) {
            return res.status(500).json({
                success: false,
                error: getErr.message
            });
        }
        
        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }
        
        const invoice = result[0];
        const today = new Date();
        const dueDate = new Date(invoice.due_date);
        
        // Determine payment status
        let paymentStatus = 'new';
        if (dueDate < today) {
            paymentStatus = 'overdue';
        }
        
        // Update invoice
        const updateSql = `
            UPDATE sales_invoices 
            SET 
                invoice_status = 'Confirmed',
                payment_status = ?,
                modified_date = NOW()
            WHERE invoice_id = ?
        `;
        
        db.query(updateSql, [paymentStatus, invoiceId], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({
                    success: false,
                    error: updateErr.message
                });
            }
            
            res.json({
                success: true,
                message: `Invoice confirmed successfully! Status: ${paymentStatus.toUpperCase()}`,
                data: {
                    invoice_id: invoiceId,
                    invoice_status: 'Confirmed',
                    payment_status: paymentStatus
                }
            });
        });
    });
});

// ============= CANCEL SALES INVOICE =============
// POST /api/sales-invoices/:id/cancel
app.post('/api/sales-invoices/:id/cancel', (req, res) => {
    const invoiceId = req.params.id;
    console.log(`❌ Cancelling sales invoice ${invoiceId}`);
    
    const { cancellation_reason } = req.body;
    
    // Check invoice exists and is not already cancelled
    const checkSql = `SELECT invoice_status FROM sales_invoices WHERE invoice_id = ?`;
    
    db.query(checkSql, [invoiceId], (checkErr, result) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: checkErr.message
            });
        }
        
        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }
        
        if (result[0].invoice_status === 'Cancelled') {
            return res.status(400).json({
                success: false,
                error: 'Invoice already cancelled'
            });
        }
        
        // Update invoice to Cancelled
        const updateSql = `
            UPDATE sales_invoices 
            SET 
                invoice_status = 'Cancelled',
                remarks = CONCAT(IFNULL(remarks, ''), '\n[CANCELLED] ', ?),
                modified_date = NOW()
            WHERE invoice_id = ?
        `;
        
        db.query(updateSql, [cancellation_reason || 'No reason provided', invoiceId], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({
                    success: false,
                    error: updateErr.message
                });
            }
            
            res.json({
                success: true,
                message: 'Invoice cancelled successfully',
                data: {
                    invoice_id: invoiceId,
                    invoice_status: 'Cancelled'
                }
            });
        });
    });
});

// ============= DELETE DRAFT SALES INVOICE =============
// DELETE /api/sales-invoices/:id
app.delete('/api/sales-invoices/:id', (req, res) => {
    const invoiceId = req.params.id;
    console.log(`🗑️ Deleting sales invoice: ${invoiceId}`);

    // Check if invoice exists and is Draft
    const checkSql = 'SELECT invoice_no, invoice_status FROM sales_invoices WHERE invoice_id = ?';

    db.query(checkSql, [invoiceId], (checkErr, checkResult) => {
        if (checkErr) {
            return res.status(500).json({
                success: false,
                error: checkErr.message
            });
        }

        if (checkResult.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Invoice not found'
            });
        }

        const invoiceNo = checkResult[0].invoice_no;
        const status = checkResult[0].invoice_status;
        
        // Check if invoice is Confirmed or Posted (can't delete)
        if (status === 'Confirmed' || status === 'Posted') {
            return res.status(400).json({
                success: false,
                error: `Cannot delete ${status} invoice. Cancel it first.`
            });
        }

        // Delete invoice (cascade will delete items)
        const deleteSql = 'DELETE FROM sales_invoices WHERE invoice_id = ?';

        db.query(deleteSql, [invoiceId], (deleteErr) => {
            if (deleteErr) {
                console.error('❌ Delete error:', deleteErr);
                return res.status(500).json({
                    success: false,
                    error: 'Delete failed: ' + deleteErr.message
                });
            }

            console.log(`✅ Invoice "${invoiceNo}" deleted`);
            res.json({
                success: true,
                message: `Invoice "${invoiceNo}" deleted successfully`
            });
        });
    });
});

// ============= GET CUSTOMERS WITH INVOICES =============
app.get('/api/sales-invoices/customers-with-invoices', (req, res) => {
    const sql = `
        SELECT DISTINCT c.customer_id, c.customer_name, c.customer_code
        FROM customers c
        INNER JOIN sales_invoices si ON c.customer_id = si.customer_id
        ORDER BY c.customer_name
    `;
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error('❌ Customer filter error:', err);
            return res.status(500).json({ 
                success: false, 
                error: err.message 
            });
        }
        
        res.json({ 
            success: true, 
            data: results 
        });
    });
});

// ============= SALES INVOICE SUMMARY =============
app.get('/api/sales-invoices/summary', (req, res) => {
    const summarySql = `
        SELECT 
            COUNT(*) as total_count,
            COALESCE(SUM(grand_total_fc), 0) as total_invoice,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN grand_total_fc ELSE 0 END), 0) as total_paid,
            COALESCE(SUM(CASE WHEN payment_status IN ('new', 'partial') THEN balance_amount ELSE 0 END), 0) as total_unpaid,
            COALESCE(SUM(CASE WHEN payment_status = 'overdue' THEN balance_amount ELSE 0 END), 0) as total_overdue,
            COALESCE(SUM(CASE WHEN invoice_status = 'Draft' THEN 1 ELSE 0 END), 0) as draft_count,
            COALESCE(SUM(CASE WHEN invoice_status = 'Confirmed' THEN 1 ELSE 0 END), 0) as confirmed_count,
            COALESCE(SUM(CASE WHEN invoice_status = 'Cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count
        FROM sales_invoices
        WHERE invoice_status != 'Cancelled'
    `;

    db.query(summarySql, (err, result) => {
        if (err) {
            console.error('❌ Summary error:', err);
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        const summary = result[0] || {};
        
        res.json({
            success: true,
            data: {
                total_invoice: summary.total_invoice || 0,
                total_paid: summary.total_paid || 0,
                total_unpaid: summary.total_unpaid || 0,
                total_overdue: summary.total_overdue || 0,
                counts: {
                    total: summary.total_count || 0,
                    draft: summary.draft_count || 0,
                    confirmed: summary.confirmed_count || 0,
                    cancelled: summary.cancelled_count || 0
                }
            }
        });
    });
});

// Test if backend API is working

// ============= START SERVER =============

app.listen(PORT, () => {
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`🔧 API Test: http://localhost:${PORT}/api/test`);
    console.log(`📊 List DBs: http://localhost:${PORT}/api/dbs`);
    console.log(`➕ Insert Test: http://localhost:${PORT}/api/insert-test`);
});