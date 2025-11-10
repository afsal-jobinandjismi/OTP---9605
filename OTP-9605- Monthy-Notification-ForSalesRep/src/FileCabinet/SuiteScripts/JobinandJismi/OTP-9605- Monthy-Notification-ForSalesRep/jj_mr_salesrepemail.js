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
 * @returns {Search} A NetSuite search object containing sales orders.
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
                        ["trandate", "within", "lastmonth"]
                    ],
                    columns: [
                        search.createColumn({ name: "entity", label: "Customer" }),
                        search.createColumn({ name: "tranid", label: "Document Number" }),
                        search.createColumn({ name: "amount", label: "Amount" }),
                        search.createColumn({ name: "salesrep", label: "Sales Rep" }),
                        search.createColumn({ name: "email", join: "customerMain", label: "Customer Email" })
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
                let amount = result.values.amount;

                let key = salesRepId || 'admin';
                let value = {
                    customerName,
                    customerEmail,
                    orderId,
                    amount
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
// **
//  * Compiles grouped sales data into CSV and sends email notifications.
//  *
//  * @param {Object} reduceContext - The context object provided by NetSuite.
//  * @param {string} reduceContext.key - Sales rep ID or 'admin'.
//  * @param {string[]} reduceContext.values - Array of JSON strings with sales data.
//  * @throws {Error} Logs error if CSV creation or email sending fails.
//  */

        function userReduce(reduceContext) {
            try {
                let salesData = reduceContext.values.map(JSON.parse);
                let csvLines = ['Customer,Email,Sales Order #,Sales Amount'];

                salesData.forEach(data => {
                    csvLines.push(`${data.customerName},${data.customerEmail},${data.orderId},${data.amount}`);
                });

                let csvContent = csvLines.join('\n');
                let csvFile = file.create({
                    name: `sales_data_${reduceContext.key}.csv`,
                    fileType: file.Type.CSV,
                    contents: csvContent,
                    folder: 299
                });

                let fileId = csvFile.save();

                let recipientEmail;
                if (reduceContext.key === 'admin') {
                    recipientEmail = ADMIN_EMAIL;
                } else {
                    recipientEmail = getSalesRepEmail(reduceContext.key) || ADMIN_EMAIL;
                }

                if (!recipientEmail) {
                    log.error('No valid email found for key: ' + reduceContext.key);
                    return;
                }

                let subject = 'Monthly Sales Report';
                let body = reduceContext.key === 'admin'
                    ? 'Please assign sales representatives to the following customers. See attached report.'
                    : 'Please find your monthly customer sales report attached.';


                let authorId = -5;
                let recipientId = reduceContext.key !== 'admin' ? parseInt(reduceContext.key) : null;
                let recipientEmails = recipientId ? getSalesRepEmail(recipientId) : ADMIN_EMAIL;

                if (!recipientEmails) {
                    log.error('No valid email found for key: ' + reduceContext.key);
                    return;
                }

                email.send({
                    author: authorId,
                    recipients: recipientEmail,
                    subject: subject,
                    body: body,
                    attachments: [file.load({ id: fileId })]
                });

                let messageRecord = record.create({
                    type: record.Type.MESSAGE,
                    isDynamic: true
                });

                messageRecord.setValue({ fieldId: 'author', value: authorId });
                messageRecord.setValue({ fieldId: 'subject', value: subject });
                messageRecord.setValue({ fieldId: 'message', value: body });
                messageRecord.setValue({ fieldId: 'activitytype', value: 'EMAIL' });
                messageRecord.setValue({ fieldId: 'recipientemail', value: recipientEmail });

                if (recipientId) {
                    messageRecord.setValue({ fieldId: 'recipient', value: recipientId });
                }

                messageRecord.save();

                try {
                    if (recipientId && fileId) {
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
                        log.audit('File attached', `File ${fileId} attached to employee ${recipientId}`);
                    }
                } catch (attachErr) {
                    log.error('Error attaching file', attachErr);
                }





                log.audit('Email Sent', `To: ${recipientEmails}, File: ${csvFile.name}`);
            } catch (e) {
                log.error('Error in reduce', e);
            }
    };

/**
 * Retrieves the email address of a sales representative.
 *
 * @param {number} salesRepId - Internal ID of the sales rep (employee record).
 * @returns {string|null} The email address of the sales rep, or null if not found.
 * @throws {Error} Logs error if record load fails.
 */

        let getSalesRepEmail = (salesRepId) => {
            try {
                let repRecord = record.load({
                    type: record.Type.EMPLOYEE,
                    id: salesRepId
                });
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
 *
 * @param {Object} summaryContext - The context object provided by NetSuite.
 * @param {number} summaryContext.usage - Governance units consumed.
 * @param {number} summaryContext.seconds - Execution time in seconds.
 * @throws {Error} Logs error if summary processing fails.
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
