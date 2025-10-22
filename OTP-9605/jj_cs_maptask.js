/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/email', 'N/file', 'N/record', 'N/runtime', 'N/search', 'N/log'],
    /**
     * @param{email} email
     * @param{file} file
     * @param{record} record
     * @param{runtime} runtime
     * @param{search} search
     * @param{log} log
     */
    (email, file, record, runtime, search, log) => {

        const ADMIN_EMAIL = 'ss2extend09225pj@oracle.com';
        const getInputData = () => {
            return userGetInput();
        }

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

        const map = (mapContext) => {
            return userMap(mapContext);
        }

        function userMap(mapContext) {
            try {
                const result = JSON.parse(mapContext.value);
                const salesRepId = result.values.salesrep?.value || null;
                const customerName = result.values.entity?.text || 'Unknown';
                const customerEmail = result.values['email.customerMain'] || 'Undefined';
                const orderId = result.values.tranid;
                const amount = result.values.amount;

                const key = salesRepId || 'admin';
                const value = {
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

        const reduce = (reduceContext) => {
            return userReduce(reduceContext);
        }

        function userReduce(reduceContext) {
            try {
                const salesData = reduceContext.values.map(JSON.parse);
                const csvLines = ['Customer,Email,Sales Order #,Sales Amount'];

                salesData.forEach(data => {
                    csvLines.push(`${data.customerName},${data.customerEmail},${data.orderId},${data.amount}`);
                });

                const csvContent = csvLines.join('\n');
                const csvFile = file.create({
                    name: `sales_data_${reduceContext.key}.csv`,
                    fileType: file.Type.CSV,
                    contents: csvContent,
                    folder: 299
                });

                const fileId = csvFile.save();

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

                const subject = 'Monthly Sales Report';
                const body = reduceContext.key === 'admin'
                    ? 'Please assign sales representatives to the following customers. See attached report.'
                    : 'Please find your monthly customer sales report attached.';


                const authorId = -5;
                const recipientId = reduceContext.key !== 'admin' ? parseInt(reduceContext.key) : null;
                const recipientEmails = recipientId ? getSalesRepEmail(recipientId) : ADMIN_EMAIL;

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

                const messageRecord = record.create({
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

        const getSalesRepEmail = (salesRepId) => {
            try {
                const repRecord = record.load({
                    type: record.Type.EMPLOYEE,
                    id: salesRepId
                });
                return repRecord.getValue('email');
            } catch (e) {
                log.error('Error loading sales rep email', e);
                return null;
            }
        };

        const summarize = (summaryContext) => {
            return userSummarize(summaryContext);
        }

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
