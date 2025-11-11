/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */

/************************************************************************************************ 
 *  
 * OTP-9605 : Monthly Sales Notification for Sales Rep
 * 
************************************************************************************************* 
 * 
 * Author: Jobin and Jismi IT Services 
 * 
 * Date Created : 21-October-2025 
 * 
 * Description : This script generates monthly sales reports for sales representatives based on sales orders from the previous month.
 *              It compiles customer sales data into CSV files and emails them to the respective sales reps. 
 *             If a sales rep is not assigned, the report is sent to an admin email and a message to add a sales rep.
 * 
 * 
 * REVISION HISTORY
 *
 * @version 1.0 : 21-October-2025 :  The initial build was created by JJ0414
 * 
*************************************************************************************************/
define(['N/email', 'N/file', 'N/record', 'N/runtime', 'N/search', 'N/log'],
    /**
     * @param{email} email
     * @param{file} file
     * @param{record} record
     * @param{runtime} runtime
     * @param{search} search
     * @param{log} log
     * 
     * In get Input Data:
     * - Search for sales orders from the previous month.
     * 
     * In Map:
     * - Extract relevant fields and group by sales rep.
     * 
     * In Reduce:
     * - Compile data into CSV files.
     * - Email files to sales reps or admin if no rep is assigned.
     * - Log messages and attach files to employee records.
     * 
     * In Summarize:
     * - Log usage statistics and errors.
     * 
     */
    (email, file, record, runtime, search, log) => {

        let ADMIN_EMAIL = 'ss2extend09225pj@oracle.com';
        let getInputData = () => {
            return userGetInput();
        }

        /**
         * Retrieves sales orders from the previous month for processing.
         *
         * @returns {search} A NetSuite search object containing sales orders.
         * @throws {Error} Logs and returns null if search creation fails.
         */

        function userGetInput() {
            try {
                return search.create({
                    type: search.Type.SALES_ORDER,
                    filters: [
                        ["type", "anyof", "SalesOrd"],
                        "AND",
                        ["mainline", "is", "T"],
                        "AND",
                        ["trandate", "within", "lastmonth"],
                        "AND",
                        ["customer.isinactive", "is", "F"]
                    ],
                    columns: [
                        search.createColumn({ name: "entity", label: "Customer" }),
                        search.createColumn({ name: "tranid", label: "Document Number" }),
                        search.createColumn({ name: "salesrep", label: "Sales Rep" }),
                        search.createColumn({ name: "email", join: "customerMain", label: "Customer Email" }),
                        search.createColumn({ name: "fxamount", label: "Amount (Foreign Currency)" }),
                        search.createColumn({ name: "currency", label: "Currency" })
                    ]


                });
            } catch (e) {
                log.error('Error in getInputData', e);
            }
        };

        let map = (mapContext) => {
            return userMap(mapContext);
        }

        /**
         * Processes each sales order record in the Map stage.
         *
         * @param {Object} mapContext - The context object provided by NetSuite.
         * @param {string} mapContext.key - Key for grouping (sales rep ID or 'admin').
         * @param {string} mapContext.value - JSON string of sales order data.
         * @throws {Error} Logs error if parsing or writing fails.
         */

        function userMap(mapContext) {
            try {
                let result = JSON.parse(mapContext.value);
                let salesRepId = result.values.salesrep?.value || null;
                let customerName = result.values.entity?.text || 'Unknown';
                let customerEmail = result.values['email.customerMain'] || 'Undefined';
                let orderId = result.values.tranid;
                let amount = result.values.fxamount;
                let currency = result.values.currency?.text || '';

                let key = salesRepId || 'admin';
                let value = {
                    customerName,
                    customerEmail,
                    orderId,
                    amount,
                    currency
                };

                mapContext.write({
                    key: key,
                    value: JSON.stringify(value)
                });
            } catch (e) {
                log.error('Error in map', e);
            }
        };

        let reduce = (reduceContext) => {
            return userReduce(reduceContext);
        }

        /** * Formats amount with currency symbol.
                 *
                 * @param {number} amount - The monetary amount.
                 * @param {string} currencyCode - The currency code (e.g., 'USD', 'EUR').
                 * @returns {string} Formatted amount with currency symbol.
        */

        function formatAmount(currencyCode, amount) {
            switch (currencyCode) {
                case 'US Dollars': return `$${amount}`;
                case 'British Pounds Sterling': return `€${amount}`;
                case 'Canadian Dollars':
                case 'CAD':
                    return `C$${amount}`;
                case 'GBP': return `£${amount}`;
                case 'INR': return `₹${amount}`;
                default: return `${currencyCode} ${amount}`;
            }
        }
        // // **
        // //  * Compiles grouped sales data into CSV and sends email notifications.
        // //  *
        // //  * @param {Object} reduceContext - The context object provided by NetSuite.
        // //  * @param {string} reduceContext.key - Sales rep ID or 'admin'.
        // //  * @param {string[]} reduceContext.values - Array of JSON strings with sales data.
        //  * @throws {Error} Logs error if CSV creation or email sending fails.
        //  */

        function userReduce(reduceContext) {
            try {
                let salesData = reduceContext.values.map(JSON.parse);
                let csvLines = ['Customer,Email,Sales Order #,Sales Amount'];

                salesData.forEach(data => {
                    let amountWithCurrency = formatAmount(data.currency, data.amount);
                    csvLines.push(`${data.customerName},${data.customerEmail},${data.orderId},${amountWithCurrency}`);
                });

                let csvContent = csvLines.join('\n');
                let csvFile = file.create({
                    name: `sales_data_${reduceContext.key}.csv`,
                    fileType: file.Type.CSV,
                    contents: csvContent,
                    folder: 299
                });

                let fileId = csvFile.save();

                let recipientEmail = reduceContext.key === 'admin'
                    ? ADMIN_EMAIL
                    : getSalesRepEmail(reduceContext.key) || ADMIN_EMAIL;

                if (!recipientEmail) {
                    log.error('No valid active email found for key: ' + reduceContext.key);
                    return;
                }

                let subject = 'Monthly Sales Report';
                let body = reduceContext.key === 'admin'
                    ? `Dear Admin,

                       Please assign sales representatives to the following customers. See attached report for details.

                       Best regards,
                       Sales Team`
                    : `Dear Sales Representative,

                       Please find attached your monthly customer sales report. The report includes details of customer transactions, sales orders, and overall performance for the period.

                    Best regards,
                    Admin`;

                let authorId = -5;
                let recipientId = reduceContext.key !== 'admin' ? parseInt(reduceContext.key) : null;

                if (!recipientEmail) {
                    log.error('Skipping email send: inactive or missing recipient for key ' + reduceContext.key);
                    return;
                }

                email.send({
                    author: authorId,
                    recipients: recipientEmail,
                    subject: subject,
                    body: body,
                    attachments: [file.load({ id: fileId })]
                });

                try {
                    if (reduceContext.key !== 'admin' && fileId && recipientId) {
                        record.attach({
                            record: {
                                type: 'file',
                                id: fileId
                            },
                            to: {
                                type: 'employee',
                                id: recipientId
                            }
                        });
                        log.audit('File attached', `File ${fileId} attached to employee ${reduceContext.key}`);
                    }
                } catch (attachErr) {
                    log.error('Error attaching file', attachErr);
                }

                log.audit('Email Sent', `To: ${recipientEmail}, File: ${csvFile.name}`);
            } catch (e) {
                log.error('Error in reduce', e);
            }
        };
        /**
                * Retrieves the email address of a sales representative,
                * skipping inactive employees.
                *
                * @param {number|string} salesRepId - Internal ID of the sales rep (employee record).
                * @returns {string|null} The email address of the sales rep, or null if inactive/not found.
        */
        let getSalesRepEmail = (salesRepId) => {
            try {
                let repRecord = record.load({
                    type: record.Type.EMPLOYEE,
                    id: parseInt(salesRepId)
                });

                let isInactive = repRecord.getValue('isinactive');
                if (isInactive) {
                    log.audit('Inactive Sales Rep skipped', `Employee ID ${salesRepId} is inactive`);
                    return null;
                }

                return repRecord.getValue('email');
            } catch (e) {
                log.error('Error loading sales rep email', e);
                return null;
            }
        };

        let summarize = (summaryContext) => {
            return userSummarize(summaryContext);
        }

        /**
         * Summarizes the Map/Reduce execution, logging usage and errors.
         */
        function userSummarize(summaryContext) {
            try {
                log.audit('Summary', `Usage: ${summaryContext.usage}, Seconds: ${summaryContext.seconds}`);

                summaryContext.mapSummary.errors.iterator().each((key, error) => {
                    log.error(`Map Error for key ${key}`, error);
                    return true;
                });

                summaryContext.reduceSummary.errors.iterator().each((key, error) => {
                    log.error(`Reduce Error for key ${key}`, error);
                    return true;
                });
            } catch (e) {
                log.error('Error in summarize', e);
            }
        };

        return { getInputData, map, reduce, summarize };
    });

